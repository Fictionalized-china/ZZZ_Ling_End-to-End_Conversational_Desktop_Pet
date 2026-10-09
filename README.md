# 铃宝桌宠聊天

一只待在桌面的伙伴，连接两台 Windows 电脑。文字、图片和粘贴截图经过 Cloudflare 实时转发，仅双方在线且都未忙碌时才能聊天。

面向 Windows 10／11 x64，提供同一个免安装 exe。目前版本为 `0.1.0` 线上测试版。

[下载免安装 EXE](https://github.com/Fictionalized-china/ZZZ_Ling_End-to-End_Conversational_Desktop_Pet/raw/refs/heads/main/%E9%93%83%E5%AE%9D.exe) · [下载整个仓库 ZIP](https://github.com/Fictionalized-china/ZZZ_Ling_End-to-End_Conversational_Desktop_Pet/archive/refs/heads/main.zip)

![桌宠运行预览](docs/images/pet-preview.png)

## 使用方式

1. 下载仓库 ZIP 并解压，或使用 `git clone` 拉取仓库。在根目录双击 **`铃宝.exe`** 即可启动；不需要安装 Node.js、编译源码或安装 Git LFS。两台电脑使用同一个 exe。
2. 一方点击 **菜单 → 生成我的配对码**，把配对码告诉另一方。
3. 另一方在菜单输入配对码，点击 **确认**。配对成功且双方在线后即可聊天。
4. 双击桌宠，右上方出现输入框。可以输入文字、选择图片，或用 `Ctrl+V` 粘贴截图，再点击 **发送**。
5. **状态** 可选择在线或忙碌。忙碌时双方都不能收发新消息，草稿保留。
6. **菜单** 中勾选某个动作代表停用该动作；全部停用时显示静态形象。
7. **调整大小** 提供四档大小；**置顶** 同时控制桌宠和弹窗。拖动角色可移动位置。
8. **取消配对** 或 **退出程序** 结束本次会话。关闭聊天输入框不会退出桌宠。

当前配对不跨进程保存；短暂断网会自动重连。配对码未使用时有效期 10 分钟，过期后取消并重新生成。开机自启只启动程序，仍须重新配对；启用自启后请保留 exe 原有位置。

根目录 exe 是完整的 Windows x64 免安装程序，可单独复制到其他电脑使用；启动时需要的组件会自动解包到临时目录。首次运行可能显示未知发布者提示，因为当前版本没有代码签名证书。

本次交付的 exe 已内置 `https://dafeyu.tap041120.online`，正常情况下无需填写连接地址。需要更换中继时，在 **菜单 → 连接设置** 修改。客户端遵循 Windows 系统代理。

使用账号已有域名的独立子域名接入，不需要购买新域名。当前开发电脑不使用代理时，真实云端协议与 Electron 双客户端通信均已通过；仍需在两台实际 Win10／Win11 电脑的日常网络上完成验收，不能保证所有运营商与地区的连通情况。

## 隐私与范围

- 不建立账号、联系人或群聊；每组配对最多两台客户端。
- 文字和图片不写入本地聊天记录或云端消息数据库。最近消息在内存中有数量与容量上限，取消配对或退出后清空。
- 大小、位置、动作偏好、置顶、自启与中继地址属于本地设置，会保存在用户应用数据目录。
- 配对控制元数据不含消息正文或图片；异常离开的会话元数据在 7 天无活动后清理。
- 使用 HTTPS/WSS 传输加密，首版不包含端到端加密、语音、视频、文件附件、自动更新或离线补发。
- 图片在内存中转为 PNG；最长边超过 4096 像素会按比例缩小，传输结果大于 8 MiB 会提示拒绝。
- Windows 锁屏、安全桌面和独占全屏不在普通置顶保证范围内。

## 免费方案

中继采用兼容 Workers Free 的 Workers 与 SQLite Durable Objects；不购买服务器或域名，不启用消息存储服务。本次部署没有新增或升级付费订阅。免费套餐达到额度后会拒绝相应请求，额度与账号下其他服务共享。[官方额度](https://developers.cloudflare.com/durable-objects/platform/pricing/)

本次 OAuth 没有订阅读取权限，不能据此确认账号当前套餐。如果账号原本已开通付费套餐，仍适用该账号的原有计费规则。详细边界见部署说明。

## 本地开发

推荐使用当前受支持的 Node.js LTS 和 npm，Windows x64 环境。依赖版本以 `package-lock.json` 为准。

```powershell
git clone https://github.com/Fictionalized-china/ZZZ_Ling_End-to-End_Conversational_Desktop_Pet.git
cd ZZZ_Ling_End-to-End_Conversational_Desktop_Pet
npm ci
npm run dev:server
```

另开终端启动桌宠：

```powershell
npm run dev
```

运行检查：

```powershell
npm run check
npm test
npm run test:integration
npm run build
npm run test:desktop
npm run test:desktop-network
```

`test:integration` 启动真实本地 Cloudflare Worker，以两个 WebSocket 客户端测试协议。`test:desktop` 使用真实 Electron 检查透明窗口、preload、IPC 与首屏。`test:desktop-network` 使用真实 Electron 网络客户端测试配对、消息、忙碌门禁、送达确认和取消后的内存清理。

指定 `DAFEYU_TEST_RELAY_URL` 后，两个网络测试会连接真实 HTTPS 中继，不启动本地 Worker；每次使用独立临时配对并在结束后取消。`DAFEYU_TEST_DIRECT=1` 可让桌面网络测试显式使用直连，避免系统代理影响验证。不要以这项单机双客户端测试替代大陆两台实际电脑的验收。

`npm run dev:ui` 的 `http://127.0.0.1:5173/?preview=1` 仅供视觉检查，明确不支持配对；生产构建不会包含该预览夹具。

## 部署与打包

见 [部署说明](docs/部署说明.md)。服务器地址通过打包环境变量或本机 `.env` 设置，Cloudflare 密钥不进入 exe。

```powershell
$env:DAFEYU_RELAY_URL = 'https://dafeyu.tap041120.online'
npm run package
```

构建输出位于 `release/`。仓库根目录额外保留完整的 `铃宝.exe`，满足拉取后双击使用的要求；它作为普通二进制文件提交，不使用 Git LFS。更新发布包时将构建结果复制为根目录 exe，并同步验收记录中的版本、大小与 SHA-256。其余中间构建文件和依赖目录不提交。

## 素材与开发记录

- [开发计划](docs/开发计划.md)
- [素材说明](docs/素材说明.md)
- [验收记录](docs/验收记录.md)
- [开发待办](TODO.md)

六组动画由用户提供。原始像素未修改，`assets/pet/integrity.json` 记录整理前 SHA-256，`npm run check` 检查 48 帧完整性。

仓库未附带开放源代码许可证；动画与角色素材的权利归原权利人所有。本次上传不代表对第三方素材作出额外授权。
