# แผนแก้ระบบตรวจคอนเทนท์ (Creative Checklist) + ความเร็ว Dashboard

> เอกสารนี้คือสเปคสำหรับ agent/คนที่ทำงานต่อ ถ้าเจอ checkbox ที่ยังไม่ติ๊ก ให้ทำต่อจากตรงนั้น
> **Git workflow ของ repo นี้: ห้าม commit ลง `main` เด็ดขาด — ทุกอย่างต้องเป็น branch + PR (`gh pr create`) เสมอ**

## ปัญหาที่วิเคราะห์ไว้ (ยืนยันจากโค้ดแล้ว)

1. **Threshold วนลูปหลอกตัวเอง** — `scripts/refresh-checklist.ts` ตั้ง `passThreshold` จาก percentile 20 ของคะแนน Top ads เท่านั้น ไม่เคยเทียบกับแอดแย่ → พอ Top ads ได้คะแนนต่ำ ระบบก็ "ลดเกณฑ์ให้ผ่านง่ายขึ้น" (80 → 50) แทนที่จะถามว่า checklist แยกแอดดี/แย่ได้จริงไหม
2. **เลือก Top ads แบบรวมทุกอย่าง** — `selectTopCreatives()` รวมทุกบัญชี/สาขา/ประเภทแคมเปญ/สื่อ เรียงตาม CPI อย่างเดียว
3. **วิดีโอถูกตรวจจาก thumbnail เฟรมเดียว แต่ยังนับข้อที่ต้องดูวิดีโอจริง** — ข้อ `tech-hook3s` (hook 3 วิแรก) และ `proof-testimonial` (มีคนพูดเล่าเคส) ตัดสินจากภาพนิ่งไม่ได้ → AI ตอบ fail เกือบตลอด (pass rate 12.5% / 25%) → คะแนนวิดีโอต่ำปลอม → ดึง percentile ลง → เกณฑ์ถูกลดให้ทุกคน
4. **AI ตอบไม่นิ่ง + ไม่มี timeout** — `lib/creative-checklist-ai.ts` ไม่ตั้ง temperature (default 1) และ fetch ไม่มี timeout/retry
5. **อัปโหลดรูปเต็มไฟล์ (สูงสุด 8MB) ตรงไปให้ AI** — ช้าและแพงโดยไม่จำเป็น
6. **Dashboard: cache หมดอายุแล้วคนแรกต้องรอโหลด Meta ใหม่ทั้งหมด** — `lib/server-cache.ts` ไม่มี stale-while-revalidate

## PR 1 — branch `fix/checklist-discriminative-scoring`

### 1.1 `lib/creative-checklist.ts`
- [x] เพิ่ม field ใน `ChecklistItem`: `requiresVideoPlayback?: boolean` — ข้อที่ต้องดูวิดีโอจริงถึงตัดสินได้
- [x] เพิ่ม field ใน `ChecklistConfig`: `passThresholdByMedia?: Partial<Record<MediaType, number>>`
- [x] `scoreChecklist()`:
  - ข้าม (ไม่นับทั้ง totalWeight และ checkedWeight) item ที่ `requiresVideoPlayback === true` — เพราะระบบวิเคราะห์จากภาพนิ่งเสมอ ข้อพวกนี้ให้ user ตรวจเองแทน
  - เลือกเกณฑ์ผ่านจาก `passThresholdByMedia[mediaType]` ถ้ามี ไม่งั้น fallback `passThreshold`
  - เพิ่ม `threshold: number` ใน `ChecklistScoreResult` (ตัวเลขเกณฑ์ที่ใช้จริง เพื่อให้ UI แสดงถูก)
- [x] เพิ่ม helper `manualCheckItems(config, mediaType)` → รายการ `{ categoryLabel, item }` ของข้อที่ apply กับสื่อนั้นแต่ `requiresVideoPlayback` (ไว้แสดงเป็น "ตรวจเองก่อนขึ้นแอด")

### 1.2 `lib/creative-checklist-stats.ts`
- [x] เพิ่ม `computeSeparationThreshold(topScores, bottomScores, options)`:
  - loop เกณฑ์ทีละ `step` (default 5) ในช่วง `[min=50, max=85]`
  - เลือกค่าที่ balanced accuracy สูงสุด: `(สัดส่วน top ≥ t + สัดส่วน bottom < t) / 2`
  - ถ้าเสมอกันหลายค่า เลือกค่ากลาง (median) ของกลุ่มที่เสมอ
  - ถ้า `bottomScores.length < minBottomSample` (default 5) → fallback ไปใช้ `computeDataDrivenThreshold(topScores)` แบบเดิม
- [x] เพิ่ม `computeItemLifts(topRates, bottomRates)` → ต่อ item: `{ id, topRate, bottomRate, lift: topRate - bottomRate, topTotal, bottomTotal }`
- [x] เพิ่ม `findNonDiscriminativeItems(lifts, maxLift = 10, minSampleSize = 5)` — ข้อที่ Top ทำไม่ต่างจาก Bottom (lift ≤ maxLift) = ข้อที่ไม่ช่วยแยกแอดดี → flag ให้ทบทวน (ไม่ลบอัตโนมัติ)
- [x] เพิ่ม `computeWeightUpdatesFromLifts(lifts, minSampleSize = 5)`: `lift ≥ 25` → weight 2, ต่ำกว่านั้น → weight 1 (แทน `computeWeightUpdates` เดิมที่ดูแค่ pass rate ของ Top ซึ่งให้รางวัลข้อ "ใครๆ ก็ทำ" ไม่ใช่ข้อที่ทำนายผล)
- [x] คงฟังก์ชันเดิมไว้ทั้งหมด (backward compat + tests เดิม)

### 1.3 `scripts/refresh-checklist.ts`
- [x] เปลี่ยน `selectTopCreatives` → เลือกทั้ง **Top N (CPI ต่ำสุด)** และ **Bottom N (CPI สูงสุด)** จากกลุ่มที่ `hasReliableCost` ผ่านเหมือนกัน (env: `CHECKLIST_TOP_N` เดิม, เพิ่ม `CHECKLIST_BOTTOM_N` default = TOP_N; ห้ามซ้ำกับ Top)
- [x] ตอน AI ตรวจ: กรอง item ที่ `requiresVideoPlayback` ออกจาก `relevantItems` (ตรวจจาก thumbnail ไม่ได้)
- [x] คะแนนแยกตามสื่อ: เก็บ `topImageScores/topVideoScores/bottomImageScores/bottomVideoScores`
- [x] คำนวณ:
  - `passThresholdByMedia.image = computeSeparationThreshold(topImage, bottomImage)`
  - `passThresholdByMedia.video` = ถ้า top video ≥ 6 ตัว → `computeSeparationThreshold(topVideo, bottomVideo, { minBottomSample: 3 })` ไม่งั้นใช้ค่า image
  - `passThreshold` (รวม, ไว้ backward compat) = `computeSeparationThreshold(topAll, bottomAll)`
- [x] weight updates ใช้ `computeWeightUpdatesFromLifts` และ sourceNote รายงานข้อ non-discriminative แทน weak items เดิม
- [x] sourceNote + GitHub summary อธิบายวิธีใหม่ (เทียบ Top vs Bottom, เกณฑ์เลือกจากจุดที่แยกสองกลุ่มได้ดีสุด)

### 1.4 `lib/creative-checklist-ai.ts`
- [x] `temperature: 0` ใน body ของ OpenAI call (ภาพเดิม → ผลเดิม)
- [x] timeout: `AbortSignal.timeout(30_000)` ตอนดึงรูป, `AbortSignal.timeout(60_000)` ตอนเรียก OpenAI
- [x] retry 1 ครั้ง (delay ~2s) เมื่อเจอ 429/5xx/network error/timeout — เฉพาะฝั่ง OpenAI call

### 1.5 `app/api/creative-checklist/analyze/route.ts`
- [x] กรอง `requiresVideoPlayback` ออกจาก `relevantItems` ที่ส่งให้ AI
- [x] response เพิ่ม `manualItems` (จาก `manualCheckItems(config, mediaType)`) — ข้อที่ user ต้องตรวจเองด้วยตา

### 1.6 `components/CreativeChecklist.tsx`
- [x] **ย่อรูปฝั่ง browser ก่อนอัปโหลด**: ถ้าด้านยาวสุด > 1280px หรือไฟล์ > 1.5MB → วาดลง canvas ย่อเหลือ max 1280px แล้ว `toBlob("image/jpeg", 0.85)` ส่งไฟล์ที่ย่อแทน (ชื่อไฟล์เดิม .jpg) — ถ้าย่อไม่สำเร็จให้ fallback ส่งไฟล์เดิม
- [x] แสดงเกณฑ์ผ่านจาก `result.threshold` (ไม่ใช่ `config.passThreshold` ตรงๆ)
- [x] รายการหลัก: ไม่ render item ที่ `requiresVideoPlayback` (มันไม่ถูกนับคะแนนแล้ว)
- [x] เพิ่มกล่องสีเหลือง "ข้อที่ AI ตรวจจากภาพนิ่งไม่ได้ — ตรวจเองก่อนขึ้นแอด" (แสดงเฉพาะ mediaType = video) มี checkbox local state เฉยๆ ไม่คิดคะแนน

### 1.7 `data/creative-checklist.json`
- [x] เพิ่ม `"requiresVideoPlayback": true` ให้ `proof-testimonial` และ `tech-hook3s`
- ไม่ต้องแก้ passThreshold เอง — ให้ weekly refresh รอบถัดไปคำนวณด้วยวิธีใหม่ (trigger ได้ด้วย `gh workflow run checklist-refresh.yml` หลัง merge)

### 1.8 Tests (`tests/`)
- [x] `creative-checklist.test.ts`: เคส requiresVideoPlayback ไม่ถูกนับคะแนน, เคส `passThresholdByMedia` ถูกใช้ตาม mediaType, เคส `result.threshold`
- [x] `creative-checklist-stats.test.ts`: `computeSeparationThreshold` แยกสองกลุ่มได้ / fallback เมื่อ bottom ไม่พอ / clamp, `computeItemLifts`, `computeWeightUpdatesFromLifts`, `findNonDiscriminativeItems`
- [x] รัน `npm run check` (test + tsc) ต้องผ่านหมด และ `npm run lint`

### 1.9 ปิดงาน PR 1
- [x] commit บน branch `fix/checklist-discriminative-scoring`
- [x] push + `gh pr create --base main` — อธิบายปัญหา circular threshold + video thumbnail + สรุปการแก้

## PR 2 — branch `feat/insights-swr-cache` (แตกจาก `main` ใหม่ ไม่ต้องรอ PR 1)

### 2.1 `lib/server-cache.ts`
- [ ] เพิ่ม option `staleTtlMs` ให้ `getServerCache(key, ttlMs, loader, forceRefresh, opts?)`
- [ ] พฤติกรรม: ถ้า entry หมดอายุแต่ยังไม่เกิน `staleTtlMs` นับจาก expiresAt → **คืนค่าเก่าทันที** (`hit: true, stale: true`) แล้วยิง loader เบื้องหลังผ่านกลไก inFlight เดิม (กัน refresh ซ้อน, `.catch()` กัน unhandled rejection — ถ้า refresh เบื้องหลังพัง ให้เก็บค่าเก่าไว้)
- [ ] เกิน staleTtlMs → รอ loader เหมือนเดิม; `forceRefresh` → ข้าม cache เหมือนเดิม
- [ ] เพิ่ม `stale?: boolean` ใน `CacheResult`

### 2.2 `app/api/insights/route.ts`
- [ ] ส่ง `staleTtlMs: 60 * 60 * 1000` (เสิร์ฟของเก่าได้ไม่เกิน 1 ชม. ระหว่างรีเฟรชเบื้องหลัง)
- [ ] ใส่ `stale` ลงใน `cache: {...}` ของ response (UI จะได้แสดง "กำลังอัปเดต" ได้ในอนาคต)

### 2.3 Tests
- [ ] `server-cache.test.ts`: เคสคืน stale ทันที + loader ถูกเรียกเบื้องหลัง 1 ครั้ง, เคสเกิน staleTtl ต้องรอ loader, เคส background refresh ล้มเหลวแล้วยังเสิร์ฟค่าเก่าได้
- [ ] `npm run check` ผ่าน

### 2.4 ปิดงาน PR 2
- [ ] commit + push + `gh pr create --base main`

## สิ่งที่ตัดสินใจไว้แล้ว (อย่าเปลี่ยนโดยไม่ถาม user)
- ข้อ requiresVideoPlayback **ไม่นับคะแนน** (ไม่ใช่แค่ลด weight) — เพราะ AI ไม่มีข้อมูลจะตัดสิน การนับ = noise
- เกณฑ์ผ่านเลือกจาก **จุดที่แยก Top/Bottom ได้ดีสุด** ไม่ใช่จุดที่ทำให้ Top ผ่านเยอะสุด — นี่คือหัวใจของการเลิก "ลด % ให้ผ่านง่าย"
- ห้าม auto-ลบเกณฑ์ — ข้อที่ไม่ discriminate แค่ถูก flag ใน sourceNote ให้คนรีวิว
- การย่อรูปทำฝั่ง browser ไม่ใช่ server (ลดทั้งเวลาอัปโหลดและ token)

## สถานะล่าสุด
- อัปเดต checkbox ด้านบนทุกครั้งที่ทำเสร็จ แล้ว commit ไฟล์นี้ไปกับงานด้วย
