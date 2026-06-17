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
4. สร้าง Pull Request ไปยัง `main`
5. รอ user review และ approve ก่อน merge

## ห้ามทำ:
- `git commit` บน `main` โดยตรง
- `git push origin main` โดยตรง
- Merge โดยไม่ผ่าน PR

## ตัวอย่างคำสั่ง:
```bash
git checkout -b fix/your-description
# ... ทำการแก้ไข ...
git add -A
git commit -m "fix: description"
git push -u origin fix/your-description
# แล้วสร้าง PR ผ่าน GitHub CLI หรือแจ้ง user
```
<!-- END:git-workflow-rules -->
