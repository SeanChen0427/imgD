# imgD 專案交接：請 Claude 接手排查 GitHub 網站無法開啟

## 0. 2026-11-05 新證據：已確認 HiNet 網頁防護介入連線

**本節優先於下方 2026-11-04 的舊診斷。網站在 Wi-Fi 上仍未恢復；現在已找到具體攔阻證據，不應再只當成不明 GitHub 節點故障。**

- 使用者後續回報：使用 5G 可以開啟，使用原本 Wi-Fi 不能開啟，並已重新連回 Wi-Fi 供測試。
- 2026-11-05 約 00:18–00:20（台灣時間）重新測試：GitHub Pages 的 `185.199.108.153`、`109.153`、`110.153` 仍在 TLS 握手階段遭連線重設；`185.199.111.153` 回 HTTP 200。
- **關鍵發現：** 對失敗節點的公開 HTTP 請求，回傳 `HTTP/1.0 200 OK` 與一段 HTML，使用 `meta refresh` 導向 `http://wfs.hinet.net`；導向參數含 `flag=W` 及本專案主機名稱。
- 同樣對正常節點的 HTTP 請求，得到 GitHub 的正常 HTTP 301，導向原網址的 HTTPS。
- HiNet 公開攔阻頁程式將 `W` 的預設畫面對應為「防駭守門員攔阻畫面」。這是 HiNet 網頁防護介入的證據；實際申租哪個方案仍需電信商依用戶線路確認。
- 當時 Mac 的系統 HTTP／HTTPS 代理開關均為 0；直接指定目的 IP 仍被攔阻，所以不應直接建議只換 DNS 就能修好。
- 原始導向網址含線路相關識別參數，**不要將完整參數貼到公開 GitHub、申訴文或聊天中**。本文件已省略這些值。

可重新驗證的無個資命令：

```sh
curl -sS --connect-timeout 4 --max-time 8 \\
  --resolve seanchen0427.github.io:80:185.199.108.153 \\
  http://seanchen0427.github.io/imgD/
```

此命令不跟隨攔阻頁導向、不解除防護、不修改 DNS／hosts；若回應包含用戶識別參數，請先遮蔽再分享。

**處理方向：** 聯絡中華電信客服 **0800-080-123**，請其查詢目前寬頻線路的防駭／網頁過濾紀錄，確認並處理對 `seanchen0427.github.io` 及相關 GitHub Pages 節點的疑似誤擋。使用者的 `imgD` 與 `BNI-VP` 兩個路徑都受影響。不能假設重新部署、改前台或清除瀏覽器快取能解除此攔阻。

今天才發生，可能與情資名單或分類判定更新有關；確切原因、分類及解除方式需由 HiNet 確認。不要把這個推測寫成已證實的事故原因。

官方服務與客服資料：[中華電信防駭守門員](https://www.cht.com.tw/home/consumer/mobservice/value-added/698)。

---

更新日期：2026-11-04（Asia/Taipei）  
狀態：**功能已實作、GitHub 已部署，但使用者的瀏覽器仍發生連線重設；問題尚未解決。**

## 1. 使用者要的結果與不可偏離的方向

使用者想做一個提供自己、太太及學員使用的產品照片下載工具：

> 打開網址 → 貼上廠商產品頁或分類頁網址 → 一鍵收集照片並下載 ZIP。

明確要求：

- 使用 GitHub，使用者已再次強調希望維持 GitHub 前台／入口。
- 無須註冊、登入、密碼、API Key，使用者不應填任何後端連線設定。
- 太太或學員不應被要求更換 DNS、切換網路或學習部署，才能日常使用。
- 現在希望 Claude 接手查明並修復問題，不是重新設計整個產品。
- **不要自行把改用其他網址當成問題已解決。** 若確實需要改架構或網域，先說明證據及取捨。

換網路曾被提出作為故障診斷。使用者只回覆「我現在就是用 wifi」，沒有回報手機行動網路的測試結果。不要把這當成已完成跨網路測試。

## 2. 專案、網址與版本

| 項目 | 值 |
| --- | --- |
| GitHub 儲存庫 | https://github.com/SeanChen0427/imgD |
| 正式 GitHub 前台 | https://seanchen0427.github.io/imgD/ |
| 分支／發布目錄 | `main`／`docs`，Pages 選 Deploy from a branch |
| 抓圖 API | https://imgd-photo-api.seankuichen.chatgpt.site |
| 健康檢查 | https://imgd-photo-api.seankuichen.chatgpt.site/api/health |
| 本機執行 | `npm run dev` → http://localhost:8787 |

本文件位於專案根目錄；Claude Code 可直接以本文件所在目錄接手。第一次交接前，本機工作樹沒有尚未提交的程式變更。

交接前最後的功能／介面版本為：

```text
c7141f9ed299d91adf03ff98a47ed1785a898f15
```

該版本的 GitHub Pages workflow 已確認 `completed / success`。但部署成功不能代表使用者的瀏覽器已能開啟。

## 3. 最優先處理的未解問題

### 3.1 真實瀏覽器錯誤

在使用者電腦的 Chrome 開啟正式 GitHub 網址，實際看到：

```text
無法連上這個網站
連線已重設。
ERR_CONNECTION_RESET
```

重新載入後仍出現此錯誤。這次錯誤發生在網站內容載入前，不能用移除登入、修改 JavaScript 或重跑部署就宣稱已修復。

### 3.2 同一台電腦的連線測試

當時 DNS 查詢得到四個 GitHub Pages IPv4 位址。以相同網址、保留正確主機名稱與 TLS 憑證驗證、僅用 `curl --resolve` 選擇連線節點，結果如下：

| 當時測試的 GitHub Pages IP | 結果 |
| --- | --- |
| `185.199.108.153` | `curl: (35) Recv failure: Connection reset by peer`，HTTP `000`，TLS 尚未完成 |
| `185.199.109.153` | 同上 |
| `185.199.110.153` | 同上 |
| `185.199.111.153` | HTTP `200`，TLS 約 0.11 秒，總時間約 0.44 秒 |

另外觀察到：

- 一般 `curl` 有時回連線重設，有時可取得 HTTP 200。
- `curl -4 --http1.1` 曾連上 `185.199.111.153` 並正常取得首頁。
- `github.com/SeanChen0427/imgD` 儲存庫頁面曾回 HTTP 200。
- 透過可連通的節點，能下載到真正的 imgD 首頁、正確 `config.js`、樣式及 JavaScript，不是錯誤頁或空白文件。
- 線上 `app.js` 曾通過 `node --check`。

**以上是當時、該電腦的實測，不是持續監控結果。請重新驗證，不要假設 IP 或狀態永久不變。**

### 3.3 尚未能確定的原因

目前證據指向「到部分 GitHub Pages 節點的連線路徑出問題」，但沒有證明具體是哪個環節造成。

可能需要分別排查：網路路由、代理、VPN、安全軟體、DNS 回傳與瀏覽器連線快取，以及 GitHub／CDN 當時的服務狀況。

不要直接斷言：

- 一定是使用者 Wi-Fi 壞了。
- 一定是 DNS 解析錯誤；當時確實解析到正常的 GitHub Pages 位址。
- 一定是 Cloudflare 後端或 CORS；首頁連線重設和載入後 API 失敗是不同階段。
- 換網路一定就能解決；尚無該測試結果。

## 4. 已完成的功能

- 廠商產品／分類頁網址輸入。
- 自動追蹤同來源的產品連結及下一頁連結，最多可選 1、10、30、100 頁。
- 抽取圖片標籤、常見懶載入屬性、`srcset`、`picture`、放大圖屬性、直接原圖連結。
- 解析 JSON-LD Product／ProductGroup、內嵌 CSS 背景圖、Open Graph 圖片。
- 圖片預覽、搜尋、全選、反選及手動勾選。
- 網址去重，下載時再用 SHA-256 合併相同檔案內容。
- 瀏覽器產生 ZIP，包含照片、`圖片來源.csv` 和 `下載紀錄.txt`。
- CSV 匯出、停止收集／下載、部分失敗紀錄。
- 已移除會員／密碼與管理用連線設定畫面。
- `docs/config.js` 預設正式服務網址，不需要使用者自行設定。
- 啟動時清除舊版 `localStorage` 的 `imgd-api` 與 `sessionStorage` 的 `imgd-token`，避免舊設定蓋過正式服務。

目前 UI 的服務狀態標籤是「服務已就緒／服務暫時無法連線」，不是登入入口。

## 5. 架構與重要檔案

```text
GitHub Pages：docs/index.html + app.js + styles.css + zip.js
        │
        │ HTTPS fetch，credentials: omit
        ▼
公開抓圖 API：Cloudflare Workers runtime，經 Sites 託管
        │
        ▼
讀取廠商公開 HTML／圖片，回傳頁面抽取結果或圖片 bytes
        │
        ▼
前台在瀏覽器打包 ZIP
```

| 檔案 | 用途 |
| --- | --- |
| `docs/index.html` | GitHub 前台；目前已無設定對話框或設定按鈕 |
| `docs/app.js` | 收集佇列、服務檢查、預覽、選取、下載與 ZIP 打包流程 |
| `docs/config.js` | 架設者維護的公開 API base URL |
| `docs/styles.css` | 前台樣式；已移除 Google Fonts 的外部 `@import` |
| `docs/zip.js` | 不依賴 CDN 的 ZIP STORE 寫入器 |
| `src/api.js` | `/api/health`、`/api/scan-page`、`/api/image` |
| `src/extract.js` | 使用 linkedom 抽取 HTML 圖片與可追蹤連結 |
| `src/security.js` | 公開網址、IP 範圍、重新導向、逾時、回應大小檢查 |
| `src/worker.js` | Worker 入口與公開 DNS 檢查 |
| `server.mjs` | 本機前台及 API；下載固定到已驗證的 DNS 解析 IP |
| `wrangler.toml` | 可自行部署 Cloudflare 的設定，不等同目前 Sites 的正式部署設定 |
| `test/` | 現有 9 項測試 |
| `.deploy/imgd-api/` | gitignored 的實際 Sites 部署 checkout，可能只有原機才存在 |

前台目前的資產版本參數為 `v=20261104-3`。已確認可連通的 GitHub 節點回傳此版本，且頁面不含 `settings-dialog` 或 `settings-button`。

## 6. API 合約

不使用使用者帳號、Authorization 或 API Token。

```http
GET /api/health
```

預期：

```json
{"ok":true,"name":"imgD"}
```

```http
POST /api/scan-page
Content-Type: application/json

{"url":"https://廠商網址/產品或分類頁","filterNoise":true}
```

回傳 `title`、`url`、`images`、`links`、`warnings`。每張圖包含 `url`、`alt`、`kind`、`source`，部分含尺寸。

```http
POST /api/image
Content-Type: application/json

{"url":"https://廠商或CDN/圖片.jpg","referer":"https://廠商/來源頁"}
```

回傳圖片 bytes 與正確圖片 Content-Type。錯誤回傳 JSON `{"error":"說明"}`。

Sites 正式環境的 `ALLOWED_ORIGINS` 最後設定為：

```text
https://seanchen0427.github.io,https://imgd-photo-api.seankuichen.chatgpt.site
```

請檢查 OPTIONS 與瀏覽器實際 Origin；來源檢查不等於登入驗證。

## 7. 後端正式部署的實際情況

正式後端是經 Sites 連接器發布，**不是透過這台電腦目前的 Wrangler 登入直接部署**。

```text
project_id: appgprj_6aeaf15d6a7c819189d32245041e9c25
目前已知發布版本：2
已知部署 ID：appgdep_6aeb4aef39848191bbd5ca223d240d87
已知 source commit：a3a6627183072629995137163c8bc453d75e250f
```

- 最後讀取的 Site 狀態為 active／public，沒有帳號登入門檻。
- 讀取過最近錯誤紀錄，當時沒有回傳錯誤事件；這不代表未來永遠沒有錯誤。
- 原機 `.deploy/imgd-api/.openai/hosting.json` 保存上述專案身分，更新應重用它。
- 本機 Wrangler 的 Cloudflare 登入曾過期。不要讓學員處理主機登入，也不要把 `worker:check --dry-run` 成功當成正式部署成功。
- 若 Claude 沒有 Sites 存取能力，應明確說明；不要建立另一個不相干後端，再宣稱已更新既有服務。
- Codex 曾把完整前台也放在 API 根網址，當作備用入口。**使用者後來明確要求維持 GitHub，因此該入口不是本次驗收解答。** 該備用頁也可能落後於 GitHub 最新的免設定 UI；不要混淆兩邊版本。

本文件不包含任何 GitHub、Sites 或 Cloudflare 憑證。若需要部署權限，使用接手環境的正常授權流程。

## 8. 已驗證與未驗證的界線

已驗證：

- `npm test`：9 項通過。
- `npm run check`：通過。
- `npm run worker:check`：Worker 可成功打包；此命令不會部署。
- 之前曾在本機、Worker 本機 runtime，以及當時可開啟的 GitHub 線上前台，從以下公開測試商店收集並下載 11 張照片。

```text
https://books.toscrape.com/catalogue/category/books/travel_2/index.html
```

- 下載的 ZIP 曾使用 Python 標準函式庫 `zipfile` 檢查 CRC、檔名、來源清單及 11 張照片，通過。
- 最後一次移除設定介面後，JavaScript 語法與 DOM ID 綁定檢查通過，GitHub 部署成功。

尚未驗證／尚未通過：

- 最後這個免設定 UI 版本在使用者 Chrome 的完整線上操作：仍被連線重設阻擋。
- 使用者太太或學員手機的實際開啟結果。
- 手機行動網路對照測試結果。
- 實際廠商網站的完整抓圖效果：使用者尚未提供廠商範例網址。
- 舊版 iPhone／Safari 的 `AbortSignal.any`、`AbortSignal.timeout` 等功能相容性；如有需要應實測，不要直接認定為本次首頁連線重設的原因。

現有抓圖器不執行廠商 JavaScript，不能保證取得登入、驗證、無限捲動或動態載入後才出現的全部照片。

## 9. 可直接使用的診斷命令

在專案根目錄：

```sh
npm ci
npm test
npm run check
npm run dev
```

DNS 與 GitHub 首頁：

```sh
python3 -c 'import socket; print(sorted(set(r[4][0] for r in socket.getaddrinfo("seanchen0427.github.io",443,type=socket.SOCK_STREAM))))'

curl -sS --connect-timeout 5 --max-time 12 \
  -o /tmp/imgd-page.html \
  -w 'HTTP=%{http_code} IP=%{remote_ip} TLS=%{time_appconnect} TOTAL=%{time_total}\n' \
  https://seanchen0427.github.io/imgD/
```

重現當時四個節點的差異（先重新確認當前 DNS；以下位址是先前觀察值）：

```sh
for ip in 185.199.108.153 185.199.109.153 185.199.110.153 185.199.111.153; do
  curl -sS --connect-timeout 4 --max-time 7 \
    --resolve "seanchen0427.github.io:443:$ip" \
    -o /dev/null \
    -w "NODE=$ip HTTP=%{http_code} TLS=%{time_appconnect} TOTAL=%{time_total}\n" \
    https://seanchen0427.github.io/imgD/
done
```

`--resolve` 僅影響該次 curl 請求，不修改系統 DNS 或 hosts。保留 TLS 憑證驗證，**不要加 `-k`**。這是工程診斷，不是要給太太或學員的使用方式。

API 健康檢查：

```sh
curl -sS --connect-timeout 5 --max-time 15 \
  -H 'Origin: https://seanchen0427.github.io' \
  https://imgd-photo-api.seankuichen.chatgpt.site/api/health
```

## 10. 工具限制與避免重踩的地方

- 本機 `gh auth status` 曾顯示登入憑證失效；先前 GitHub 寫入改用已連接的 GitHub 工具完成。請不要輸出或從瀏覽器抽取憑證。
- GitHub 工具的 `update_ref` 曾多次 ReadTimeout；不能只呼叫就假設寫入成功。後來以 contents API 的逐檔更新成功發布。任何失敗後都先讀遠端狀態再重試。
- 內建瀏覽器的自動化工具曾回 `browser.user is unavailable`。這是工具能力錯誤，不能當成網站錯誤；另以 Chrome 確認的 `ERR_CONNECTION_RESET` 才是真實網站連線證據。
- 瀏覽器工具拒絕開啟 `chrome://net-internals/#dns`，只允許 HTTP(S)。沒有清除 DNS 快取，也沒有透過其他手段繞過限制。
- 沒有修改使用者 DNS、hosts、代理、VPN 或防火牆。若考慮這類變更，先說明影響並取得使用者同意；不要把更改每位使用者的網路設定當成產品方案。
- `/private/tmp` 的診斷輸出與部署包可能已清除，不應當成唯一依據。
- 連線錯誤截圖檔名為 `imgd-github-connection-error.png`，位於原 Codex 對話的本機視覺化輸出目錄；Claude 在其他電腦不一定能讀到。即使沒有截圖，也已有本文件的文字診斷結果可重新驗證。

## 11. 建議接手順序

1. 先讀本文件、`README.md` 與最新 GitHub 版本，確認本機與遠端差異。
2. 獨立重現 GitHub 首頁開啟問題，記錄時間、瀏覽器錯誤、DNS、連線節點與 HTTP/TLS 結果。
3. 分開判斷「網頁根本未載入」及「網頁載入後 API 或圖片下載失敗」。
4. 若是網頁本身錯誤，修正、測試並重新發布原 GitHub Pages。
5. 若確認受網路／CDN 節點影響，明確說明可證實與不能證實的部分；提出符合使用者 GitHub 要求的一次性架設端方案。無法達成時直接說明，不要反覆要求家人／學員操作複雜診斷，也不要偷偷換入口。
6. 以真正的瀏覽器重新打開正式 GitHub 網址，確認無登入、無連線設定，能實際收集並下載 ZIP；不要只看 CI 的綠勾。

## 12. 完成標準

- 使用者確認的 GitHub 入口能實際開啟。
- 太太／學員只需開網址、貼廠商網址、下載，不做主機或連線設定。
- 至少一個產品／分類頁實際測試，ZIP 可解壓、照片可開啟、來源與失敗紀錄清楚。
- 仍有問題時，明確交代重現條件與限制，不宣稱「任何人都能用」或「已全部修好」。

## 可貼給 Claude 的接手提示

> 請先閱讀專案根目錄的 CLAUDE_HANDOFF.md，再接手 imgD。我要維持 GitHub 前台，讓太太和學員開網址即可貼入廠商網址下載照片，不要登入、API Key 或連線設定。現在 GitHub 網址會出現 ERR_CONNECTION_RESET。請依文件區分已驗證證據和推測，先獨立重現，再修復並用真實瀏覽器驗收；不要只看部署成功，也不要擅自換成其他入口。
