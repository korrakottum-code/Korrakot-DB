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

## การตรวจสอบก่อน Merge

ใช้คำสั่งเหล่านี้จากโฟลเดอร์โปรเจกต์:

```bash
npm test
npx tsc --noEmit
npm run check
```

`npm run check` เป็นคำสั่งรวม test และ TypeScript สำหรับใช้เป็น release gate เดียวกันในแต่ละ PR

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
