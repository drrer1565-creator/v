# VideoKit × Canva 编辑器联动搭建指南

通过本方案，你可以在 Canva 编辑器左侧栏打开 **VideoKit 插件**，直接基于当前页（包含 Canva 官方免费/Pro 素材）或个人 Uploads 素材，调用 VideoKit 的 **214 款滚动字幕 (`sc-01..sc-214`)、250 款 T 字幕 (`sub-01..sub-250`)、红雀红褐色羽毛 (`cardinal_feather`)、逐句跟读 (`sentence`) 与免费 Edge 配音**，并将渲染好的高清 MP4 自动放回当前 Canva 页面。

---

## 1. 为什么这套架构合规且画质无损？

1. **走 Canva 官方 `requestExport` 合成链路**：插件并非跳过授权提取单个 Canva Stock 原片，而是以当前登录用户身份触发 Canva 官方的 `@canva/design` `requestExport()` 接口导出当前画布视频/画面；若是 Pro 素材且当前为 Pro 账号即无水印输出。
2. **闭环增值创作后插回 Canva**：VideoKit 后端将字幕/滚动卡/配音烧录合成为 MP4，通过一次性防猜高熵直链 + `@canva/asset` `upload()` 与 `@canva/design` `addElementAtPoint()` 插回页面，你在 Canva 内继续二次排版并最终从 Canva 导出成片，符合 Canva Developer Terms 的闭环准则。

---

## 2. 服务端部署（支持本机 Cloudflare Tunnel 穿透 或 云服务器）

### 方式一：在本机 / 内网电脑运行 + Cloudflare Tunnel 转公网 HTTPS（推荐个人/工作室使用）

Canva 编辑器插件运行在严格 HTTPS 沙盒中，且 `@canva/asset` 的 `upload({ url })` 要求下载链接 **严格 `https://`、`200 OK`、无跳转、非 `localhost` / 裸 IP**。使用 Cloudflare Tunnel 可零公网 IP 一键把本机变成 HTTPS 后端：

1. **启动 VideoKit Web 渲染服务**（推荐开启 API Token 防他人调用）：
   ```powershell
   $env:VIDEOKIT_API_TOKEN = "换成你自己的强密码Token"
   $env:VIDEOKIT_WEB_PORT = "5080"
   npm run start:web
   ```
   *(若已知固定公网域名，还可设置 `$env:VIDEOKIT_PUBLIC_BASE_URL = "https://videokit.yourdomain.com"`，否则服务端会自动识别反向代理的 `X-Forwarded-Proto` 与 `X-Forwarded-Host`。)*

2. **使用 Cloudflare Tunnel 映射 HTTPS**：
   ```powershell
   cloudflared tunnel --url http://127.0.0.1:5080
   ```
   会得到一个临时或固定域名（如 `https://xxxx.trycloudflare.com` 或绑定自己的自定义 HTTPS 域名）。

---

## 3. 已新增的服务端 HTTP 接口（位于 `bin/videokit-web-server.cjs` + `electron/services/canva-bridge.js`）

- `GET /api/canva/presets`：返回全部 **214 款滚动样式 (`sc-01..sc-214`)**、**250 款 T 字幕 (`sub-01..sub-250`)**、**35 款叠加组 (`ov-*`)** 与包含 **红雀羽毛/红雀鸟** 在内的光标图标清单及 `sentence` / `word` / `char` 出字单位。
- `POST /api/canva/render`：异步提交渲染任务，支持传入 `mediaUrl`、`preset`、`revealType`、`cursorKind`、`edgeVoice`、`scrollTitle`、`text` / `segments` / `srt`，自动探测背景视频时长与保留原声比例。
- `GET /api/canva/jobs/:jobId`：轮询任务进度与最终下载直链 `outputUrl` / 封面图 `thumbnailUrl`。
- `GET / HEAD /api/canva/files/:jobId/:fileToken/render.mp4`（及 `thumb.jpg`）：凭单次高熵 `fileToken`（含 30 分钟 TTL 自动过期清理与严格 `timingSafeEqual` 校验）直接 `200 OK` 输出文件流，供 Canva 服务器直接拉取上传。

---

## 4. 启动 Canva 前端插件（位于 `canva-app/`）

1. 在 [Canva Developers Portal](https://www.canva.com/developers/) 创建新 App，并开启以下权限（与 `canva-app/canva-app.json` 一致）：
   - `canva:design:content:read`（必需：`requestExport` 读取当前页合成输出）
   - `canva:design:content:write`（必需：将成片插回画布）
   - `canva:asset:private:write`（必需：上传渲染好的视频至当前用户媒体库）
   - `canva:asset:private:read`（可选：如选中你自己在 Uploads 里传的文件，可免等待直接读取）
2. 进入插件目录安装依赖并运行本地预览：
   ```powershell
   cd canva-app
   npm install
   npm start
   ```
3. 登录你在 Developer Portal 的同一 Canva 账号打开任意视频设计，在左侧 **Apps -> Your apps（预览模式）** 中打开 **VideoKit Reels & Subtitles**：
   - 填入你的 **HTTPS 公网地址**（如 `https://videokit.yourdomain.com`）与 `API Token`，点 **连接并同步全部 VideoKit 预设**；
   - 选择预设（如 `sc-39` 或 `sub-245`）、出字粒度（`按整句 (逐句)`）、跟随图标（`🪶 红雀红褐羽毛`），输入字幕文案，点击 **「调用 VideoKit 渲染并插入当前页」** 即可完成！
