# VideoKit 4.6.2-beta.2 (测试版)

> 🧪 **测试版说明**：面向内测与早期验证发布，如需稳定生产环境可随时切换回正式版通道。

## 本次 4.6.2-beta.2 核心更新

### 0. 🐛 修复批量导出 `_exportResolvedNames.slice is not a function` 报错
- 修复 `_resolveReelsJobBaseNames` 返回普通对象导致全新启动批量导出时序列化 `resolvedBaseNames` 抛出 `_exportResolvedNames.slice is not a function` 的问题，并在命名解析与导出断点清单写入阶段统一归一化为数组。
- 补充端到端回归测试覆盖 `reelsStartExport()` 与 `reelsResumeExportFromJournal('failed-only')`。

### 1. 🎨 自动着色关键词选色弹窗稳定修复
- 修复 **🎨 自动着色**（自定义关键词等规则）中点击/拖动取色器 `<input type="color">`、编辑 Hex 色值或修改关键词时弹窗跳关、失焦的问题：
  - 移除 `src/reels-overlay-panel.js` 中 `_syncToOverlay` 对规则列表 DOM 的无条件清空重建，规则列表仅在切换覆层、加载预设或增删/切换规则类型时重绘。
  - `_commitAutoColorRules` 复用共享的 `_scheduleOverlayHostSync` 管道（全程由 `_panelSyncingOverlay` 护栏保护），防止 `onOverlayChange` 反向重入 `_syncFromOverlay`，并保留 `rAF` 渲染合并与拖动节流。

### 2. 🛡️ 长文案（2 分钟 / 30 任务）批量渲染稳定性与内存治理
- 优化 `ReelsExportScheduler`（`electron/services/reels-export-scheduler.js`）内存估算与并发上限（根据时长、多片段背景池与系统可用内存动态限流，安全限制并发 `maxActive <= 3` 并拦截低内存并发）。
- 导出与滚动渲染期间自动绕过滚动卡片位图缓存，并在每条导出结束及隔离渲染器中主动释放画布与离屏表面资源，降低长批量渲染后段崩溃风险。

### 3. 📌 导出进度持久化、断点续传与未完成单独重试
- 新增每条任务的持久化导出日志记录，崩溃或中断后保留已完成结果，支持从记录继续渲染并仅针对失败/未完成任务单独重新导出（结合磁盘输出校验）。

### 4. 🔔 导出完成系统通知 + 启动首帧样式防闪烁
- 批量导出完成后触发原生系统通知（支持点击聚焦窗口/定位输出目录）、任务栏进度与完成提醒、应用内提示及音效反馈。
- 构建阶段内联关键基础暗色主题样式到 HTML 首帧，修复冷启动瞬间出现未应用样式白屏/错位界面。

---

### 安装包说明
- Windows 安装版: `VideoKit-Setup-4.6.2-beta.2.exe`（自动检测覆盖升级并保留全部本地设置与工程数据）
- Windows 压缩包: `VideoKit-Setup-4.6.2-beta.2.zip`
- macOS Apple Silicon (M系列): `VideoKit-4.6.2-beta.2-macOS-arm64.dmg`
- macOS Intel (x64): `VideoKit-4.6.2-beta.2-macOS-x64.dmg`
- Linux AppImage: `VideoKit-4.6.2-beta.2-Linux-x86_64.AppImage`
