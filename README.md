# Meta Ads Dashboard

แดชบอร์ดภายในสำหรับดูผลโฆษณา Meta Ads แยกตามสาขา โปรแกรม แคมเปญ และครีเอทีฟ
ระบบนี้ตั้งใจให้เป็น **Read only**: ผู้ใช้ดูข้อมูลและค้นหาได้ แต่การแก้ข้อมูลสาขาต้องทำผ่าน Pull Request เท่านั้น

## ระบบทำอะไรบ้าง

- ดึง Insights และ Campaign จาก Meta Graph API
- รวมข้อมูลจาก access token ได้สูงสุด 3 ตัว และตัดข้อมูลซ้ำก่อนแสดงผล
- แสดง Spend, Impressions, Inbox, Leads, CPI และ CPL
- แสดงรูป/วิดีโอของ Creative พร้อมจัดอันดับตาม metric
- เก็บผลตอบกลับไว้ใน server cache 10 นาที และมีปุ่มรีเฟรชเพื่อดึงใหม่ทันที
- ใช้เวลาเขต `Asia/Bangkok` ในการคำนวณช่วงวันที่
- ใช้ Meta Graph API แบบ pin version เดียวที่ `v25.0` ผ่าน `lib/meta-version.ts` เพื่อให้ Insights, Campaign และ Creative อัปเกรดพร้อมกัน
- มีหน้า `/management` สำหรับสรุปภาพรวมเพื่อการบริหาร พร้อม Decision Board, pacing, data health และ trend รายวัน
- Export รายงานเป็น CSV หรือพิมพ์เป็น PDF ได้ โดยใช้ Snapshot ID เดียวกับข้อมูลบนหน้าเว็บ
- มีหน้า `/creative-review` สำหรับให้ทีมตรวจคอนเทนท์ที่กราฟิกทำเสร็จ เทียบกับ checklist ที่สรุปจากครีเอทีฟที่ติด Top จริง ก่อนตัดสินใจขึ้นแอด

## ความหมายของตัวเลขและการจัดอันดับ

- **Inbox** คือผลลัพธ์จาก Objective ที่ให้คนเริ่มบทสนทนากับ Meta
- **Lead** คือ Lead ที่ Meta รายงาน เช่น การให้เบอร์หรือข้อมูลติดต่อในแชท เป็นสัญญาณว่ามีโอกาสจองคิว ไม่ใช่หลักฐานว่าปิดการขายใน CRM แล้ว
- **CPI** = Spend ÷ Inbox; เป้าหมายใช้งานที่ตั้งไว้คือไม่เกิน `฿100`
- **CPL** = Spend ÷ Lead; ช่วงเป้าหมายใช้งานที่ตั้งไว้คือ `฿200–฿350`
- ผลลัพธ์ที่มีจำนวน Inbox/Lead น้อยจะแสดงเป็น **ข้อมูลน้อย** และไม่ถูกเสนอให้ Scale อัตโนมัติ
- `HR` และ `IG` ไม่ถูกนำไปจัดอันดับรวมกับสาขา เพราะเป็นกลุ่มคนละลักษณะกับสาขาขาย
- ช่วง `วันนี้` เป็นช่วงที่ยังไม่จบวัน ระบบจะแสดง pacing และหมายเหตุแยกจากการเทียบช่วงเต็ม

หน้า `/management` เป็น read-only เช่นเดียวกับหน้าหลัก การกดรีเฟรชเป็นการอ่านข้อมูลใหม่เท่านั้น ไม่มีคำสั่งเพิ่มงบ แก้แคมเปญ หรือเปลี่ยนข้อมูลใน Meta

## ตั้งค่าครั้งแรก

ต้องใช้ Node.js 20.9 ขึ้นไป จากนั้นรัน:

```bash
npm install
cp .env.example .env.local
```

เปิด `.env.local` แล้วใส่ Meta access token อย่างน้อยหนึ่งตัว:

```env
META_ACCESS_TOKEN=วางโทเคนตัวที่หนึ่งตรงนี้
META_ACCESS_TOKEN_2=วางโทเคนตัวที่สองตรงนี้ถ้ามี
META_ACCESS_TOKEN_3=วางโทเคนตัวที่สามตรงนี้ถ้ามี
INTERNAL_DASHBOARD_PASSWORD=รหัสผ่านสำหรับทีมอย่างน้อย12ตัวอักษร
INTERNAL_DASHBOARD_SECRET=กุญแจสุ่มอย่างน้อย32ตัวอักษร
```

ห้ามใช้ชื่อที่ขึ้นต้นด้วย `NEXT_PUBLIC_` และห้าม commit token ลง Git เพราะ API จะอ่าน token เฉพาะฝั่ง server

สร้างค่า `INTERNAL_DASHBOARD_SECRET` แบบสุ่มได้ด้วย:

```bash
openssl rand -base64 48
```

ถ้ายังไม่ตั้งรหัสผ่านและ secret ระบบจะปิดการเข้าถึงแบบ fail closed และไม่เปิดข้อมูล Dashboard/API

เริ่มระบบในเครื่องด้วย:

```bash
npm run dev
```

แล้วเปิด [http://localhost:3000](http://localhost:3000)

## Deploy บน Vercel

1. เปิด Project ใน Vercel แล้วไปที่ **Settings → Environment Variables**
2. เพิ่ม `META_ACCESS_TOKEN`, `META_ACCESS_TOKEN_2` และ `META_ACCESS_TOKEN_3` ตามจำนวนที่ใช้
3. เพิ่ม `INTERNAL_DASHBOARD_PASSWORD` และ `INTERNAL_DASHBOARD_SECRET` โดยใช้ค่าเดียวกันใน Preview และ Production ถ้าต้องการ Login ชุดเดียวกัน
4. เลือก Environment ให้ตรงกับ deployment ที่จะเปิดใช้ เช่น Production หรือ Preview
5. กด **Redeploy** หลังบันทึกตัวแปรทุกครั้ง

ถ้าหน้าจอขึ้น `No META_ACCESS_TOKEN configured` ให้ตรวจชื่อ variable, Environment และการ Redeploy ก่อน การแก้ `.env.local` ในเครื่องจะไม่เปลี่ยนค่าใน Vercel

Session Login มีอายุ 12 ชั่วโมง ผู้ใช้สามารถกด **ออกจากระบบ** จากส่วนหัวของแต่ละหน้า รหัสผ่านและ secret ต้องไม่ส่งทางแชตสาธารณะหรือบันทึกลง repository

## แก้รายชื่อสาขา (Read only)

หน้า `/settings` ใช้ดูและค้นหารายชื่อสาขาเท่านั้น ปุ่มเพิ่ม แก้ไข ลบ และเปลี่ยนสถานะถูกปิดไว้ทั้งใน UI และ API

หากต้องการแก้สาขา:

1. แก้ไฟล์ [`data/branch-config.json`](./data/branch-config.json) บน branch ใหม่
2. ตรวจ JSON ให้ถูกต้อง และตั้ง `isTest: true` เฉพาะสาขาทดสอบ
3. เปิด Pull Request เข้า `main` ให้ตรวจสอบ
4. Merge แล้วรอ Vercel deploy ข้อมูลชุดใหม่

ห้ามแก้ไฟล์นี้ตรงบน production หรือพยายามเรียก `POST /api/branches` และ `DELETE /api/branches` เพราะระบบจะตอบ `405 Method Not Allowed`

## Checklist ตรวจคอนเทนท์ก่อนขึ้นแอด (`/creative-review`)

หน้านี้ใช้ตรวจคอนเทนท์ที่ทีมกราฟิกทำเสร็จ ก่อนตัดสินใจขึ้นแอดจริง โดยเกณฑ์ใน [`data/creative-checklist.json`](./data/creative-checklist.json) สรุปมาจากการวิเคราะห์ครีเอทีฟที่ติด Top จริง (CPI ต่ำ, Inbox สูง) ไม่ใช่ความเห็นส่วนตัว

**ใช้งานแบบไม่ต้องติกเอง**: ลากภาพคอนเทนท์วางในหน้า (หรืออัปโหลดเฟรมตัวแทนจากวิดีโอ) ระบบจะส่งภาพให้ OpenAI GPT-4o Vision วิเคราะห์เทียบกับ checklist ปัจจุบันให้อัตโนมัติ แล้วติ๊กผลลัพธ์ + คำนวณ % ให้เอง (ยังแก้ผลด้วยมือได้ถ้า AI ตัดสินผิด) ต้องตั้งค่า `OPENAI_API_KEY` ใน `.env.local` ก่อนใช้งาน ดู [`.env.example`](./.env.example)

### รีเฟรช checklist อัตโนมัติทุกสัปดาห์ (GitHub Actions)

`.github/workflows/checklist-refresh.yml` รันทุกวันจันทร์ 10:00 (Asia/Bangkok) โดย `scripts/refresh-checklist.ts` จะ:

1. ดึงแอดที่ CPI ต่ำสุดและมีข้อมูลเชื่อถือได้ (Spend > 0, Inbox ≥ 5) ในช่วง 30 วันล่าสุด — เป็น "Top ads" ของสัปดาห์นั้น
2. ส่งภาพ/thumbnail ของ Top ads แต่ละอันให้ OpenAI GPT-4o Vision ให้คะแนนเทียบกับ checklist **ปัจจุบัน**
3. คำนวณ `passThreshold` ใหม่จาก percentile ของคะแนนจริงที่ Top ads ทำได้ (ไม่ใช่เลขคงที่ 80% เดิม) — แก้ปัญหาที่ Top ads บางตัวได้คะแนนแค่ ~60% แต่ยังติด Top จริง เพราะ threshold เดิมเข้มเกินสภาพจริง
4. หาข้อใน checklist ที่ Top ads "ทำตามน้อย" (pass rate < 30%) แล้วใส่คำเตือนไว้ใน `sourceNote` ให้คนรีวิว (ไม่ลบอัตโนมัติ)
5. เขียนไฟล์ `data/creative-checklist.json` ใหม่ แล้วเปิด **Pull Request** ให้รีวิวก่อน Merge เข้า `main` เสมอ (ไม่มีการ commit ตรง `main` หรือเขียนทับ production runtime เพราะ Vercel filesystem เป็น read-only)

ต้องตั้งค่า GitHub Actions Secrets ต่อไปนี้ในหน้า Settings → Secrets and variables → Actions ของ repo:

| Secret | คำอธิบาย |
| --- | --- |
| `OPENAI_API_KEY` | สำหรับเรียก GPT-4o Vision ให้คะแนนภาพ |
| `META_ACCESS_TOKEN`, `META_ACCESS_TOKEN_2`, `META_ACCESS_TOKEN_3` | Token เดียวกับที่ใช้ใน Vercel สำหรับดึง insights จาก Meta API |

รันด้วยมือได้ทันทีผ่านแท็บ **Actions → Weekly Creative Checklist Refresh → Run workflow** หรือรันในเครื่องด้วย:

```bash
OPENAI_API_KEY=... META_ACCESS_TOKEN=... npm run refresh-checklist
```

### รีเฟรชด้วยมือ (ทางเลือกเสริม)

1. เปิดหน้า `/ads` แล้วดู Creative Grid เรียงตาม Inbox/CPI เพื่อหาแอดที่ "ติด Top" ล่าสุด (Spend > 0, จำนวนผลลัพธ์ ≥ 5, CPI อยู่ในเป้าหมาย)
2. ดูภาพ/วิดีโอของแอดกลุ่มนั้นร่วมกันเป็นชุด สรุปว่ามีอะไรที่ซ้ำกัน เช่น พาดหัว, ราคา, หลักฐาน (before/after), branding, CTA
3. ปรับ/เพิ่มรายการใน `data/creative-checklist.json` ตามหมวดหมู่เดิม (`hook`, `proof`, `offer`, `branding`, `cta`, `technical`) พร้อมอัปเดต `version`, `lastUpdated` และ `sourceNote`
4. เปิด Pull Request ตาม Git workflow ปกติ ให้ตรวจสอบก่อน Merge — ห้ามแก้ไฟล์นี้ตรงบน production

การคำนวณ % ใช้ `scoreChecklist()` ใน [`lib/creative-checklist.ts`](./lib/creative-checklist.ts) คิดจากน้ำหนัก (`weight`) ของแต่ละข้อที่ถูกติ๊ก เทียบกับน้ำหนักรวมทั้งหมด และเทียบกับ `passThreshold` เพื่อสรุปว่า "ผ่าน" หรือ "ต้องแก้ไข" พร้อมแสดงรายการที่ขาดให้ทีมกราฟิกไปแก้

## การตรวจสอบก่อน Merge

ใช้คำสั่งเหล่านี้จากโฟลเดอร์โปรเจกต์:

```bash
npm test
npx tsc --noEmit
npm run check
```

`npm run check` เป็นคำสั่งรวม test และ TypeScript สำหรับใช้เป็น release gate เดียวกันในแต่ละ PR

การอัปเกรด Meta Graph API ต้องแก้ version ใน `lib/meta-version.ts` ที่เดียว แล้วตรวจ fields ที่ใช้ใน Insights/Campaign/Creative พร้อม Preview และ production smoke test ก่อน Merge

## แก้ปัญหาที่พบบ่อย

### ข้อมูลขึ้นไม่ครบ 1 รายการ

แถบเตือนจะแสดงชื่อ account และข้อความจาก Meta ให้กด **รีเฟรช** หนึ่งครั้งก่อน หากยังขึ้นซ้ำ ให้ตรวจ token และสิทธิ์ของ account นั้นใน Meta Business Manager ข้อมูล account อื่นยังดูได้ตามปกติ

### ตัวเลขไม่เท่ากันหลังเปิดหลายแท็บ

ระบบมี cache ฝั่ง browser และ server เพื่อให้เร็วขึ้น ให้กดปุ่ม **รีเฟรช** เมื่อจำเป็นต้องดึงข้อมูลใหม่ทันที

### Creative ไม่มีรูปหรือวิดีโอ

Creative บางรายการอาจไม่มี thumbnail หรือ token ไม่มีสิทธิ์อ่าน asset นั้น ระบบจะแสดงข้อมูล metric ต่อไปโดยไม่ทำให้ทั้งหน้าใช้งานไม่ได้

## โครงสร้างสำคัญ

| ส่วน | หน้าที่ |
| --- | --- |
| `app/page.tsx` | หน้า Dashboard หลัก |
| `app/ads/page.tsx` | ตาราง Campaign |
| `app/settings/page.tsx` | รายชื่อสาขาแบบ Read only |
| `app/api/insights/route.ts` | ดึงและรวม Insights |
| `app/api/campaigns/route.ts` | ดึงและรวม Campaign |
| `app/api/creative/route.ts` | ดึง thumbnail ของ Creative |
| `data/branch-config.json` | รายชื่อสาขาที่ deploy ไปพร้อมโค้ด |
| `app/management/page.tsx` | หน้า Management Reporting แบบ read-only |
| `lib/reporting.ts` | ช่วงเวลา, การรวมยอด, objective metric, confidence และ pacing |
| `lib/report-export.ts` | Snapshot ID และ CSV export ที่ไม่ใส่ข้อมูลลับ |
| `app/creative-review/page.tsx` | หน้า Checklist ตรวจคอนเทนท์ก่อนขึ้นแอด |
| `data/creative-checklist.json` | เกณฑ์ checklist ที่สรุปจากครีเอทีฟที่ติด Top จริง |
| `lib/creative-checklist.ts` | คำนวณ % ผ่าน checklist จากน้ำหนักของแต่ละข้อ |
| `lib/creative-checklist-ai.ts` | Prompt/JSON schema และการเรียก OpenAI Vision ให้คะแนนภาพ (ใช้ร่วมกันทั้ง `/api/creative-checklist/analyze` และ `scripts/refresh-checklist.ts`) |
| `lib/creative-checklist-stats.ts` | คำนวณ percentile-based `passThreshold` และ pass rate ของแต่ละข้อจากคะแนนจริงของ Top ads |
| `lib/creative-assets.ts` | ดึง thumbnail/creative asset จาก Meta API (ใช้ร่วมกันทั้ง `/api/creative` และ `scripts/refresh-checklist.ts`) |
| `scripts/refresh-checklist.ts` | สคริปต์รีเฟรช checklist อัตโนมัติทุกสัปดาห์ (รันโดย `.github/workflows/checklist-refresh.yml`) |
