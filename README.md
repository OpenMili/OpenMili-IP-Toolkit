# OpenMili IP Toolkit ⚡

极简轻量、零依赖、秒级启动的出口 IP 质量与常用服务解锁检测工具。

专为检测 **本机直连** 或 **本地代理（Clash / v2ray / SOCKS5）** 的真实出口网络质量而设计。

---

## 🚀 一行命令运行

无需克隆仓库，无需安装任何 npm 包，只要有 [Node.js (18+)](https://nodejs.org/) 即可直接运行：

### Windows (PowerShell)
```powershell
irm https://raw.githubusercontent.com/OpenMili/OpenMili-IP-Toolkit/main/openmili.ps1 | iex
```

### Linux / macOS
```bash
curl -fsSL https://raw.githubusercontent.com/OpenMili/OpenMili-IP-Toolkit/main/openmili.sh | bash
```

> **提示**：如果网络无法直接访问 GitHub，脚本内置了镜像加速兜底，国内环境亦可直接拉取执行。

---

## 💻 本地克隆运行

```bash
git clone https://github.com/OpenMili/OpenMili-IP-Toolkit.git
cd OpenMili-IP-Toolkit

# 交互式菜单（支持直接选择直连或输入代理端口）
node openmili.js

# 命令行直接运行
node openmili.js -d                        # 直连检测
node openmili.js -p 7890                   # 本地 HTTP 代理 (127.0.0.1:7890)
node openmili.js -p socks5://127.0.0.1:10808 # SOCKS5 代理
```

---

## ✨ 核心特性

- ⚡ **秒级完成**：全并发异步池化请求，耗时仅需 2~3 秒，彻底告别漫长等待与黑屏假死。
- 📦 **真正的零依赖**：基于 Node.js 原生标准库与系统 `curl`，不需要 `npm install` 任何第三方包。
- 🌐 **双栈与网络属性**：
  - IPv4 / IPv6 双栈出口检测
  - 准确识别国家、城市、ASN 与运营商组织
  - 智能分类：**住宅宽带 (Residential)** / **数据中心 (Datacenter)** / **蜂窝移动 (Mobile)**
  - 公共代理 / VPN 节点识别
- 🎯 **主流服务解锁状态**：
  - **AI 智能服务**：ChatGPT、OpenAI API、Anthropic Claude、Google Gemini、Microsoft Copilot、Grok (xAI)
  - **流媒体与娱乐**：YouTube、Netflix (原生完整片库 vs 自制剧)、Disney+、Spotify、TikTok
  - **常用服务与社交**：Google 搜索 (无验证码检测)、GitHub、Twitter / X、Reddit、Wikipedia、Telegram Web
- 🎨 **终端彩色美化**：实时流式输出测试结果，状态一目了然。

---

## 📄 License

[MIT](LICENSE)
