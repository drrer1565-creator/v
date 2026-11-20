# VideoKit 4.6.4-beta (测试版)

> 🧪 **测试版说明**：面向内测、创作者反馈与云端部署提前验证发布，包含最新创意卡片、倒计时开场、自动着色修复与云服务器热更新能力。

## 本次 4.6.4-beta 核心更新

### 1. ☁️ 云服务器与无头 CLI 全面兼容升级
- **无头 CLI 自更新命令 (`videokit-cli update`)**：支持 `--check`、`--beta`、`--stash`、`--json`、`--branch`，可通过 GitHub Releases API / Git 标签检查版本、安全拉取更新、按需安装依赖并重建 `dist/`。
- **Linux/macOS 云端一键更新脚本**：新增 `scripts/cloud-update.sh`，方便云端助手或运维脚本一键更新与体检（`--check` / `--stash` / `--skip-build`）。
- **Web 服务端智能防过期**：`bin/videokit-web-server.cjs` 自动检测 `src/` 修改时间（或 `VIDEOKIT_WEB_USE_SRC=1`），源码比 `dist/` 新时自动热切换到 `src/`；`/api/health` 新增 `commit`、`ui_source`、`platform`、`arch` 并正确报告 `4.6.4-beta` 版本号；`isolatedWysiwygExport` 补全转发封面卡片文本与延迟/音量参数。
- **无头渲染容器稳定性**：Linux 无头 Electron 自动附加 `--disable-dev-shm-usage` 防 Docker `/dev/shm` 崩溃；无头 CLI 全面支持 `intro_countdown` 延后时长、ASS 字幕平移与纯 FFmpeg 人声 `adelay`。

### 2. ⏳ 节日/圣诞倒计时圆环开场（`intro_countdown`）
- 新增可叠加在原素材前段的倒计时圆环开场动画，支持自由调节开场秒数、日期格式（如 `12.25`、`12月25日`、倒计时 35 天等）与字号自适应。
- 支持纯开场模式，以及与正文朗读/滚动字幕/逐句字幕的全链路时间轴、人声延迟（`adelay`）及画布预览同步。

### 3. 🎴 创意 Prayer Card 卡片预设与 Muse 模板导入
- 新增 20 款高辨识度、差异化设计的北美祷告/灵修主题创意卡片预设（`ov-16`～`ov-35`），支持 `inline-full` 等宽通栏条带渲染。
- 支持自动识别并吸收网络 Muse 模板 `text-layout-settings.json` 卡片布局进入 VideoKit 覆层预设。
- 精简滚动字幕重复预设，保留精选高质感滚动卡片模板（共 65 款高区分度滚动预设）。

### 4. 🔧 核心语音与字幕问题修复
- **ElevenLabs TTS 首句提取与排序**：保留文案首句提取与序列编号逻辑，确保批量生成音频排序准确不乱序。
- **自动着色关键词重叠修复**：修复 `ctx.textBaseline = 'top'` 场景下多行富文本关键词高亮换行时第二行叠压第一行的问题。

---

### 安装包说明
- Windows 安装版: `VideoKit-Setup-4.6.4-beta.exe`（自动检测覆盖升级并保留全部本地设置与工程数据）
- Windows 压缩包: `VideoKit-Setup-4.6.4-beta.zip`
- macOS Apple Silicon (M系列): `VideoKit-4.6.4-beta-macOS-arm64.dmg`
- macOS Intel (x64): `VideoKit-4.6.4-beta-macOS-x64.dmg`
- Linux AppImage: `VideoKit-4.6.4-beta-Linux-x86_64.AppImage`
