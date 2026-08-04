<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:git-workflow-rules -->
# Git Workflow — MANDATORY

**ห้าม commit ตรงไปที่ `main` โดยเด็ดขาด** ทุกการเปลี่ยนแปลงต้องผ่าน Pull Request (PR) เท่านั้น

## ขั้นตอนที่ต้องทำทุกครั้ง:
1. สร้าง branch ใหม่จาก `main` — ตั้งชื่อให้สื่อ เช่น `fix/timezone-bangkok`, `feat/add-filter`
2. Commit การเปลี่ยนแปลงบน branch นั้น
3. Push branch ขึ้น remote
4. **สร้าง Pull Request ไปยัง `main` ทันทีเสมอ** — ใช้ `gh pr create` หรือ GitHub API (ห้ามแค่ push แล้วจบ)
5. รอ user review และ approve ก่อน merge

## ห้ามทำ:
- `git commit` บน `main` โดยตรง
- `git push origin main` โดยตรง
- Merge โดยไม่ผ่าน PR
- **Push แล้วไม่สร้าง PR** — ต้องสร้าง PR ให้ user ทุกครั้ง

## ตัวอย่างคำสั่ง:
```bash
git checkout -b fix/your-description
# ... ทำการแก้ไข ...
git add -A
git commit -m "fix: description"
git push -u origin fix/your-description
# สร้าง PR ทันที (ห้ามข้ามขั้นตอนนี้)
gh pr create --title "fix: description" --body "รายละเอียด" --base main
```
<!-- END:git-workflow-rules -->

## ข้อยกเว้นเดียวของกฎ "ห้าม commit ตรง main": Weekly Creative Checklist Refresh

`.github/workflows/checklist-refresh.yml` (workflow "Weekly Creative Checklist Refresh") `git commit` + `git push origin main` **ตรงเข้า main โดยไม่ผ่าน PR** — เป็นพฤติกรรมที่ตั้งใจไว้ ไม่ใช่ช่องโหว่ที่ทำผิดกฎ:

- แก้เฉพาะ `data/creative-checklist.json` (ข้อมูลเกณฑ์ checklist ที่รันโดยบอท ไม่ใช่โค้ดแอป)
- ต้องขึ้น production ทันทีให้ Vercel redeploy ทุกสัปดาห์ — ถ้าบังคับผ่าน PR จะต้องรอคน merge ก่อนเกณฑ์ใหม่ถึงจะมีผล ซึ่งขัดกับที่ตั้งใจแก้ไว้ใน PR #32 ("remove [skip ci] so Vercel redeploys after checklist refresh")
- รันโดย `github-actions[bot]` อัตโนมัติทุกสัปดาห์ (หรือ manual trigger ผ่าน `gh workflow run checklist-refresh.yml`) ไม่ใช่ agent หรือคนแก้โค้ดตรงๆ

**ห้ามใช้ข้อยกเว้นนี้เป็นบรรทัดฐานสำหรับงานอื่น** — โค้ดแอป, config, และไฟล์อื่นทั้งหมดยังต้องผ่าน branch + PR ตามกฎด้านบนเสมอ ถ้าจะแก้ไขตัว workflow นี้เอง (ไม่ใช่แค่ข้อมูลที่มันสร้าง) ก็ยังต้องผ่าน branch + PR เหมือนไฟล์อื่น
