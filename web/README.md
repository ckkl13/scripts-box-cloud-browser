# Scripts Box 云端浏览器

这是一个完全独立的静态网页，只读取 GitHub 仓库 `ckkl13/scripts-box-sync-storage` 的 `main` 分支，不读取本地电脑文件。

## 发布

将 `web/` 保留在仓库根目录，推送到 `main` 后，GitHub Actions 会通过 Pages 发布。仓库设置中选择 **Settings → Pages → GitHub Actions**。

## 使用

- 目录和文件按 `manifest.json.gz` 显示；
- 点击文件名可预览文本、图片、音频或视频；
- 勾选多个文件后点击“下载选中”会生成 ZIP；
- “下载当前文件夹”会将当前目录下所有文件生成 ZIP；
- 私有仓库可点“访问令牌”临时输入 Fine-grained token，网页不会保存令牌。
