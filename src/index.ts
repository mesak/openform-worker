import { getFormData } from "./getFormData";
import { submitForm, FormDataType } from "./submitForm";

export interface Env {
  // Add KV or other bindings here if needed
}

// In-memory cache
// Note: This is instance-local. Cloudflare Workers may spawn multiple instances.
// This is not a shared cache across all edge locations.
const CACHE = new Map<string, { data: any, expiry: Date }>();

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "Content-Type",
};

const errorResponse = (message: string, status = 500) => {
  return new Response(JSON.stringify({
    error: true,
    message,
  }), {
    status,
    statusText: status === 500 ? "Internal Server Error" : "Bad Request",
    headers: {
      "content-type": "application/json;charset=UTF-8",
      ...CORS_HEADERS
    }
  });
}

const HTML_PAGE = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OpenForm Worker - Google Forms API</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Consolas', 'Monaco', 'Courier New', monospace; line-height: 1.6; color: #1a1a1a; background: #f5f5f5; min-height: 100vh; padding: 2rem; }
        .container { max-width: 1000px; margin: 0 auto; background: white; border: 1px solid #ddd; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        header { background: #2c3e50; color: #ecf0f1; padding: 2rem; border-bottom: 3px solid #3498db; }
        h1 { font-size: 2rem; margin-bottom: 0.5rem; font-weight: 600; letter-spacing: -0.5px; }
        .subtitle { opacity: 0.85; font-size: 0.95rem; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        .content { padding: 2rem; }
        .section { margin-bottom: 2rem; padding-bottom: 2rem; border-bottom: 1px solid #e0e0e0; }
        .section:last-child { border-bottom: none; }
        h2 { color: #2c3e50; margin-bottom: 1rem; font-size: 1.3rem; font-weight: 600; border-left: 4px solid #3498db; padding-left: 1rem; }
        .endpoint { background: #f8f9fa; border: 1px solid #dee2e6; padding: 1rem; margin: 1rem 0; font-family: monospace; }
        .method { display: inline-block; padding: 0.25rem 0.75rem; font-weight: bold; font-size: 0.875rem; margin-right: 0.5rem; font-family: monospace; border: 1px solid; }
        .get { background: #e8f5e9; color: #2e7d32; border-color: #4caf50; }
        .post { background: #e3f2fd; color: #1565c0; border-color: #2196f3; }
        code { background: #f4f4f4; padding: 0.2rem 0.5rem; border: 1px solid #ddd; font-family: 'Consolas', 'Monaco', monospace; font-size: 0.9rem; color: #c7254e; }
        pre { background: #263238; color: #aed581; padding: 1.25rem; overflow-x: auto; margin: 1rem 0; border-left: 3px solid #3498db; font-family: 'Consolas', 'Monaco', monospace; font-size: 0.85rem; line-height: 1.5; }
        pre code { background: none; color: inherit; padding: 0; border: none; }
        .features { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin: 1.5rem 0; }
        .feature { background: #fafafa; padding: 1.25rem; border: 1px solid #e0e0e0; border-left: 3px solid #3498db; }
        .feature-icon { font-size: 1.75rem; margin-bottom: 0.5rem; }
        .feature h3 { color: #2c3e50; font-size: 1rem; margin-bottom: 0.5rem; font-weight: 600; }
        .feature p { font-size: 0.875rem; color: #555; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        footer { background: #f8f9fa; padding: 1.5rem; text-align: center; color: #6c757d; border-top: 1px solid #dee2e6; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 0.9rem; }
        a { color: #3498db; text-decoration: none; }
        a:hover { text-decoration: underline; }
        ol { margin-left: 1.5rem; line-height: 2; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        h3 { margin-top: 1.5rem; color: #495057; font-size: 1.05rem; font-weight: 600; }
        .demo-section { background: #f8f9fa; padding: 1.5rem; border: 1px solid #dee2e6; margin: 1.5rem 0; }
        .input-group { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
        input[type="text"] { flex: 1; padding: 0.75rem; border: 1px solid #ced4da; font-family: monospace; font-size: 0.9rem; }
        input[type="text"]:focus { outline: none; border-color: #3498db; }
        button { padding: 0.75rem 1.5rem; background: #3498db; color: white; border: none; cursor: pointer; font-weight: 600; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        button:hover { background: #2980b9; }
        button:disabled { background: #95a5a6; cursor: not-allowed; }
        #result { background: #263238; color: #aed581; padding: 1rem; overflow-x: auto; max-height: 500px; font-family: 'Consolas', 'Monaco', monospace; font-size: 0.85rem; white-space: pre-wrap; word-wrap: break-word; display: none; border-left: 3px solid #3498db; }
        .error { color: #e74c3c; background: #fadbd8; padding: 0.75rem; border-left: 3px solid #e74c3c; }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>// OpenForm Worker</h1>
            <p class="subtitle">Google Forms REST API · Cloudflare Edge Computing</p>
        </header>
        
        <div class="content">
            <div class="section">
                <h2>功能特色</h2>
                <div class="features">
                    <div class="feature">
                        <div class="feature-icon">🚀</div>
                        <h3>超快速度</h3>
                        <p>運行在 Cloudflare 全球邊緣網路</p>
                    </div>
                    <div class="feature">
                        <div class="feature-icon">�</div>
                        <h3>無需伺服器</h3>
                        <p>Serverless 架構，自動擴展</p>
                    </div>
                    <div class="feature">
                        <div class="feature-icon">🔄</div>
                        <h3>簡單易用</h3>
                        <p>RESTful API，GET 取得、POST 送出</p>
                    </div>
                </div>
            </div>

            <div class="section">
                <h2>API 端點</h2>
                
                <div class="endpoint">
                    <span class="method get">GET</span>
                    <code>/g/{form_id}</code>
                    <p style="margin-top: 0.5rem;">取得 Google Form 的結構、問題、選項等資訊</p>
                </div>

                <div class="endpoint">
                    <span class="method post">POST</span>
                    <code>/g/{form_id}</code>
                    <p style="margin-top: 0.5rem;">送出表單回應資料</p>
                </div>
            </div>

            <div class="section">
                <h2>使用範例</h2>
                
                <h3 style="margin-top: 1.5rem; color: #495057;">1️⃣ 取得表單結構 (GET)</h3>
                <pre><code>curl https://your-worker.workers.dev/g/1FAIpQLSd...</code></pre>
                
                <h3 style="margin-top: 1.5rem; color: #495057;">2️⃣ 送出表單資料 (POST)</h3>
                <pre><code>curl -X POST https://your-worker.workers.dev/g/1FAIpQLSd... \\
  -H "Content-Type: application/json" \\
  -d '{
    "1536632002": "test@example.com",
    "1132838313": "選項 1"
  }'</code></pre>
            </div>

            <div class="section">
                <h2>線上測試</h2>
                <div class="demo-section">
                    <p style="margin-bottom: 1rem; font-size: 0.9rem; color: #666;">在此貼上 Google Form 網址，直接測試 API 解析結果：</p>
                    <div class="input-group">
                        <input type="text" id="formUrl" placeholder="貼上 Google Form 網址 (例如 https://docs.google.com/forms/d/e/.../viewform)">
                        <button onclick="fetchForm()">取得 JSON</button>
                    </div>
                    <div id="result"></div>
                </div>
            </div>

            <div class="section">
                <h2>如何取得 Form ID？</h2>
                <ol style="margin-left: 1.5rem; line-height: 2;">
                    <li>開啟您的 Google Form</li>
                    <li>點擊「傳送」按鈕</li>
                    <li>複製連結</li>
                    <li>提取 <code>/e/</code> 和 <code>/viewform</code> 之間的字串</li>
                </ol>
                <p style="margin-top: 1rem;">範例：<br>
                <code style="font-size: 0.8rem;">https://docs.google.com/forms/d/e/<strong style="color: #667eea;">1FAIpQLSezf...</strong>/viewform</code></p>
            </div>

            <div class="section">
                <h2>⚠️ 注意事項</h2>
                <p>本服務受 Cloudflare Workers 每月使用次數限制。</p>
                <p style="margin-top: 0.5rem;">若有興趣大量使用，請直接 <a href="https://github.com/mesak/openform-worker" target="_blank">Clone 本專案</a> 自行部署。</p>
            </div>
        </div>

        <footer>
            <p>🛠️ Built with Cloudflare Workers · TypeScript · Cheerio</p>
            <p style="margin-top: 0.5rem;"><a href="https://github.com/mesak/openform-worker" target="_blank">GitHub</a> · <a href="https://github.com/eiiot/openform" target="_blank">原作者 GitHub</a></p>
        </footer>
    </div>
    
    <script>
        async function fetchForm() {
            const input = document.getElementById('formUrl');
            const result = document.getElementById('result');
            const url = input.value.trim();
            
            result.style.display = 'none';
            result.className = '';
            
            if (!url) {
                result.className = 'error';
                result.textContent = '請輸入 Google Form 網址';
                result.style.display = 'block';
                return;
            }
            
            // Extract form ID from URL
            const match = url.match(/\\/e\\/([a-zA-Z0-9_-]+)/);
            if (!match) {
                result.className = 'error';
                result.textContent = '無法從網址中提取 Form ID，請確認網址格式正確';
                result.style.display = 'block';
                return;
            }
            
            const formId = match[1];
            result.textContent = '載入中...';
            result.style.display = 'block';
            
            try {
                const response = await fetch(\`/g/\${formId}\`);
                const data = await response.json();
                result.textContent = JSON.stringify(data, null, 2);
            } catch (error) {
                result.className = 'error';
                result.textContent = '錯誤: ' + error.message;
            }
        }
        
        // Allow Enter key to submit
        document.getElementById('formUrl').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                fetchForm();
            }
        });
    </script>
</body>
</html>`;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    
    // Handle OPTIONS for CORS
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Home page
    if (url.pathname === "/" || url.pathname === "") {
      return new Response(HTML_PAGE, {
        headers: { "content-type": "text/html;charset=UTF-8" }
      });
    }

    // API routes: /g/{form_id}
    const pathParts = url.pathname.split('/').filter(p => p);
    
    // Check if route starts with /g
    if (pathParts[0] !== 'g') {
      return errorResponse("Invalid route. Use /g/{form_id} for API access.", 404);
    }

    const formId = pathParts[1];

    if (!formId) {
       return errorResponse("Form ID is missing from the URL. Use /g/{form_id}", 400);
    }

    try {
      if (request.method === "GET") {
        // Check Cache
        const cached = CACHE.get(formId);
        if (cached) {
            if (cached.expiry > new Date()) {
                return new Response(JSON.stringify(cached.data), {
                    headers: { "content-type": "application/json;charset=UTF-8", ...CORS_HEADERS }
                });
            } else {
                CACHE.delete(formId);
            }
        }

        const result = await getFormData(formId);
        
        if ('error' in result && result.error) {
           return new Response(JSON.stringify(result), { 
               status: 502, // Bad Gateway (upstream error)
               headers: { "content-type": "application/json;charset=UTF-8", ...CORS_HEADERS } 
           });
        }

        // Set Cache (60 seconds)
        const expiry = new Date(Date.now() + 60_000);
        CACHE.set(formId, { data: result, expiry });

        return new Response(JSON.stringify(result), {
          headers: {
            "content-type": "application/json;charset=UTF-8",
            ...CORS_HEADERS,
          }
        });

      } else if (request.method === "POST") {
        
        // --------------------------------------------------------------------------------
        // [防止濫用] 簡單的頻率限制 (Rate Limiting)
        // ⚠️ 如果您是複製此專案自行部署，可以移除或註解掉以下這段程式碼來解除限制
        // --------------------------------------------------------------------------------
        const clientIP = request.headers.get("CF-Connecting-IP") || "unknown";
        const rateLimitKey = `limit:${clientIP}`;
        const limitRecord = CACHE.get(rateLimitKey);

        if (limitRecord && limitRecord.expiry > new Date()) {
            const currentCount = limitRecord.data || 0;
            if (currentCount >= 10) {
                return errorResponse("Too Many Requests. Rate limit: 10 requests per 10 seconds.", 429);
            }
            limitRecord.data = currentCount + 1;
        } else {
            // 設定 10 秒窗口，允許 10 次請求
            CACHE.set(rateLimitKey, { data: 1, expiry: new Date(Date.now() + 10000) });
        }
        // --------------------------------------------------------------------------------

        let body: FormDataType;
        try {
            body = await request.json() as FormDataType;
        } catch (e) {
            return errorResponse("Invalid JSON body", 400);
        }

        const result = await submitForm(formId, body);
        
        // Check if submitForm returned our specific error object
        const isError = (result as any).error === true;

        return new Response(JSON.stringify(result), {
          status: isError ? 400 : 200,
          headers: {
            "content-type": "application/json;charset=UTF-8",
            ...CORS_HEADERS,
          }
        });
      } else {
        return errorResponse(`Method ${request.method} not allowed`, 405);
      }
    } catch (err: any) {
      console.error(err);
      return errorResponse(err.message || "An unexpected error occurred.", 500);
    }
  }
};
