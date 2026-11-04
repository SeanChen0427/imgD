# imgD — 產品照片收集站

貼上廠商的產品頁／分類頁網址，按「一鍵收集下載」，自動收集可讀取的照片並下載 ZIP。前台放 GitHub Pages，抓圖 API 放 Cloudflare Worker。本機也能直接執行。

## 使用

1. 貼入廠商網址。從產品分類頁開始通常能找到更多照片。
2. 選擇收集頁數，按「一鍵收集下載」。預設最多 30 頁，可改 1／10／100 頁。
3. 工具追蹤同網站的產品／分頁連結，自動合併相同圖片網址，再依檔案內容去重，產生 ZIP。

若想先挑照片，取消「完成後自動下載 ZIP」，掃描後勾選需要的照片，按「下載 ZIP」。支援預覽、名稱搜尋、全選／反選及 CSV 匯出。

ZIP 包含 `photos/` 原始圖片、`圖片來源.csv` 和 `下載紀錄.txt`。圖片維持網站提供的格式，不重新壓縮；失敗、尚未下載及合併重複的項目會記在清單裡。程式優先使用網頁明示的原圖、放大圖或最大 srcset，不猜測／改寫圖片網址。

## 本機立刻使用

需 Node.js 22 以上（建議 24）。

```sh
npm ci
npm run dev
```

打開 **http://localhost:8787**。本機前台與後端一起啟動，不需要 Cloudflare 帳號。可複製 `.env.example` 為 `.env` 調整連接埠或密碼；伺服器僅監聽本機。

## 部署前台到 GitHub Pages

1. GitHub 儲存庫 → **Settings → Pages**。
2. Source 選 **Deploy from a branch**。
3. Branch 選 **main**，資料夾選 **/docs**，按 Save。
4. 等待 GitHub 完成部署。此儲存庫的預期網址為 **https://seanchen0427.github.io/imgD/**，實際以 Pages 顯示的網址為準。

所有前台資產使用相對路徑，支援 `/imgD/` 子路徑。前台無須打包。Google Fonts 載入失敗時使用系統字型；功能沒有第三方 CDN 依賴。

## 部署抓圖後端到 Cloudflare

GitHub Pages 是靜態服務，不能執行抓圖後端；Worker 代為讀取網頁與圖片，避開廠商網站未開放瀏覽器 CORS 的限制。

```sh
npm ci
npx wrangler login
npx wrangler secret put API_TOKEN
npm run deploy:worker
```

`API_TOKEN` 請自行輸入一組不易猜測的密碼，**不要寫入 GitHub 或 docs/config.js**。公開 Worker 預設要求密碼，未設定時不提供抓圖服務。`wrangler.toml` 的 `ALLOWED_ORIGINS` 已允許 `https://seanchen0427.github.io`；若換前台網域，請同步修改後重新部署。

完成後，打開前台的「連線設定」：

- 後端網址：Wrangler 顯示的 `https://imgd-api.你的子網域.workers.dev`，不要加 `/api`。
- 存取密碼：剛設定的 `API_TOKEN`。
- 按「測試連線」再儲存。

後端網址存於目前瀏覽器的 localStorage；密碼只存於此分頁的 sessionStorage，關閉分頁後須重新輸入。也可把公開的後端網址填入 `docs/config.js`，讓其他瀏覽器不需重填網址。

Cloudflare 依方案計算請求及流量，沒有承諾不限量或永久免費。前台來源檢查不是認證，Worker 仍以 API_TOKEN 保護。請妥善保管密碼。

## 能讀取哪些圖片

- `img`、常見懶載入屬性、`srcset`、`picture`、原圖連結及放大圖屬性。
- JSON-LD Product／ProductGroup 圖片、內嵌 CSS 背景圖、Open Graph 圖片。
- 同源產品與分頁連結；不跨網域爬取其他網站。
- 保留有意義的圖片查詢參數，支援帶簽章的 CDN 圖片網址。

Logo／小圖篩選與「產品圖片」標記是啟發式判斷，可能漏掉照片或混入非產品圖，可關閉篩選並手動勾選。外部 CSS 樣式表、JavaScript 執行後載入、點擊／無限捲動後才出現、未被連結到的產品、登入、驗證碼或反爬蟲保護均可能造成缺圖；本版不執行廠商 JavaScript，不繞過登入或驗證。因此**不保證取得整站所有照片**。若網站限制直接顯示圖片，預覽可能失敗，但仍可嘗試後端下載。

單頁回應上限 5 MB、單張圖片 20 MB、每次最多收集 1,500 張，瀏覽器打包上限 250 MB。達到頁數／圖片／容量上限會提示分批處理；容量上限時保留已完成的照片。最多同時下載 3 張。後端每 IP 每分鐘上限 90 次請求，前台遇限流會等候 60 秒再試（最多兩次），可隨時停止。停止時，掃描保留結果，下載打包已完成的部分。

後端不永久儲存照片。僅允許公開 HTTP(S)、80／443 連接埠；封鎖本機／私有／保留 IP、每次重新導向重新檢查、限制回應大小與逾時。本機下載固定 DNS 解析後的公開 IP；Worker 查詢公開 DNS 且不配置私有網路綁定。廠商登入資訊與前台密碼不會轉送給廠商。CSV 處理了試算表公式開頭及引號。

請確認廠商授權後使用下載的照片。

## 驗證與開發

```sh
npm test
npm run check
npm run worker:check
```

- `docs/`：GitHub Pages 前台、ZIP 寫入器與設定。
- `src/extract.js`：HTML／結構化資料解析。
- `src/security.js`：公開網址、重新導向、逾時與大小檢查。
- `src/api.js`：前後端共用 API。
- `src/worker.js`：Cloudflare Worker 入口。
- `server.mjs`：本機靜態前台及 API，套用 DNS 固定連線。
- `test/`：解析、來源／密碼、SSRF、圖片回應與 ZIP 互通性測試。

ZIP 互通性測試使用 Python 3 標準函式庫 `zipfile`。

官方文件：[GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)、[設定 Pages 發布來源](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)、[Cloudflare Wrangler](https://developers.cloudflare.com/workers/wrangler/commands/)、[Worker 限流綁定](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)。
