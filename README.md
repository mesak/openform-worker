# OpenForm Worker

A Cloudflare Worker-based API for programmatically accessing Google Forms. Get form structure and submit responses via simple REST API calls.

## Features

- 🚀 **Fast**: Runs on Cloudflare's edge network
-  **Simple REST API**: GET form structure, POST to submit
- 📦 **Serverless**: No server management required
- 🌍 **Global**: Low latency worldwide via Cloudflare edge
- 🎨 **Web UI**: Beautiful landing page with API documentation

## Prerequisites

1. Your Google Form must have email collection set to either "Do not collect" or "Responder input"
2. Form must not require file uploads (forces Google sign-in)
3. Form must be publicly accessible

## Installation & Deployment

```bash
# Install dependencies
npm install

# Development
npm start

# Deploy to Cloudflare Workers
npm run deploy
```

## API Usage

### Get Form ID

1. Open your Google Form
2. Click "Send" → Get link
3. Extract the ID from the URL between `/e/` and `/viewform`

Example URL:
```
https://docs.google.com/forms/d/e/1FAIpQLSezfDEk03hYi9duf1vVSDGGBFAZq2zfPNw9_smS_8X2xmfzWQ/viewform
```

Form ID:
```
1FAIpQLSezfDEk03hYi9duf1vVSDGGBFAZq2zfPNw9_smS_8X2xmfzWQ
```

### API Endpoint Format

```
https://your-worker.workers.dev/g/<form_id>
```

Local development:
```
http://localhost:8787/g/<form_id>
```

**Web UI**: Visit the root URL (`/`) for interactive documentation:
```
https://your-worker.workers.dev/
```

## GET Method - Retrieve Form Structure

Returns form metadata and all questions with their IDs, types, and options.

**Request:**
```bash
curl http://localhost:8787/g/1FAIpQLSezfDEk03hYi9duf1vVSDGGBFAZq2zfPNw9_smS_8X2xmfzWQ
```

**Response:**
```json
{
  "title": "未命名表單",
  "description": null,
  "collectEmails": "NONE",
  "questions": [
    {
      "title": "公司的MAIL",
      "description": null,
      "type": "TEXT",
      "options": [],
      "required": true,
      "id": "1536632002"
    },
    {
      "title": "test1",
      "description": null,
      "type": "MULTIPLE_CHOICE",
      "options": ["選項 1", "選項 2"],
      "required": true,
      "id": "1132838313"
    },
    {
      "title": "check2",
      "description": null,
      "type": "CHECKBOXES",
      "options": ["選項 1", "選項 2", "選項 3"],
      "required": true,
      "id": "216510093"
    }
  ],
  "error": false
}
```

### Response Schema

```typescript
{
  title: string;
  description: string | null;
  collectEmails: "NONE" | "VERIFIED" | "INPUT";
  questions: {
    title: string;
    description: string | null;
    type: "TEXT" | "PARAGRAPH_TEXT" | "MULTIPLE_CHOICE" | 
          "CHECKBOXES" | "DROPDOWN" | "DATE" | "TIME" | 
          "SCALE" | "GRID" | "FILE_UPLOAD";
    options: string[];
    required: boolean;
    id: string;
  }[];
  error: false;
}
```

## POST Method - Submit Form Response

Submit answers to the form using question IDs from the GET response.

**Request:**
```bash
curl -X POST http://localhost:8787/g/1FAIpQLSezfDEk03hYi9duf1vVSDGGBFAZq2zfPNw9_smS_8X2xmfzWQ \
  -H "Content-Type: application/json" \
  -d '{
    "1536632002": "test@example.com",
    "1132838313": "選項 1",
    "216510093": ["選項 1", "選項 3"]
  }'
```

**Request Body Format:**
```json
{
  "<question_id>": "answer",
  "<question_id>": ["answer1", "answer2"],
  "emailAddress": "optional@email.com"
}
```

**Notes:**
- Use question `id` from GET response as keys
- Single-choice questions: use string value
- Multi-choice questions (CHECKBOXES): use array of strings
- Optional: include `emailAddress` if form collects emails

**Success Response:**
```json
{
  "error": false,
  "message": "Form submitted successfully."
}
```

**Error Response:**
```json
{
  "error": true,
  "message": "Unable to submit the form. Check your form ID and email settings, and try again."
}
```

## Configuration

Edit `wrangler.jsonc`:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "openform-worker",
  "main": "src/index.ts",
  "compatibility_date": "2024-01-01",
  "compatibility_flags": ["nodejs_compat"],
  "dev": {
    "port": 8787
  }
}
```

## Caching

- GET requests are cached for 60 seconds in-memory
- Cache is instance-local (not shared across edge locations)
- Helps reduce load on Google Forms

## CORS

CORS headers are enabled by default:
- `access-control-allow-origin: *`
- `access-control-allow-methods: GET, POST, OPTIONS`
- `access-control-allow-headers: Content-Type`

## Error Handling

Common errors and solutions:

| Error | Cause | Solution |
|-------|-------|----------|
| 404 | Invalid form ID | Verify form ID from URL |
| 502 | Cannot fetch form | Check form is public |
| 400 | Invalid submission data | Verify question IDs match |

## Deployment

### 1. Customize Worker Name

**⚠️ 重要**: 部署前請先修改 `wrangler.jsonc` 中的 `name` 欄位：

```jsonc
{
  "name": "your-custom-name",  // ← 改成你想要的名稱
  "main": "src/index.ts",
  ...
}
```

這個名稱會成為你的 Worker URL：`https://your-custom-name.<subdomain>.workers.dev`

### 2. Login to Cloudflare

```bash
npx wrangler login
```

這會開啟瀏覽器讓您登入 Cloudflare 帳號並授權 Wrangler CLI。

### 3. Deploy

```bash
npm run deploy
```

部署成功後會顯示您的 Worker URL：

```
✨ Success! Uploaded to Cloudflare
https://your-custom-name.<subdomain>.workers.dev
```

### 4. Update Deployment

修改程式碼後，再次執行 `npm run deploy` 即可更新。

### Optional: Custom Domain

如果您有自己的網域，可以在 [Cloudflare Dashboard](https://dash.cloudflare.com/) 設定 Custom Domain：

1. Workers & Pages → 選擇您的 Worker
2. Settings → Triggers → Custom Domains
3. 新增網域（例如：`api.yourdomain.com`）

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Language**: TypeScript
- **Parser**: Cheerio (HTML parsing)
- **Build**: Wrangler

## License

MIT

## Credits

Inspired by [opensheet](https://github.com/benborgers/opensheet) by Ben Borgers.

Special thanks to Ben Borgers for creating opensheet, which served as the foundation and inspiration for this project. His elegant approach to creating serverless APIs for Google Sheets demonstrated how powerful and simple Cloudflare Workers can be. This project extends that philosophy to Google Forms, making form data accessible through clean REST APIs.

感謝 Ben Borgers 創建了 opensheet 專案，它為本專案提供了基礎和靈感。他對於使用 Cloudflare Workers 建立無伺服器 API 的優雅實作方式，展示了強大而簡潔的開發理念。本專案將這個理念延伸到 Google Forms，讓表單資料可以透過簡潔的 REST API 存取。
