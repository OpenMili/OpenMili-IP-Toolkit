# OpenMili IP Toolkit

检测**运行本机或指定代理的真实出口 IP**：公开库与 ASN、三网回程、IP 历史、网站 HTTP 和真实 Chromium 风控检测，最后生成中文 HTML / JSON 报告。

## 一条通用命令

先安装 [Node.js 20+ LTS](https://nodejs.org/)（含 npm/npx），系统需有 curl。在 **Windows CMD、PowerShell、Linux Bash** 中输入同一条命令，从本 GitHub 仓库下载运行：

```text
node -e "const c=require('child_process'),p=c.spawnSync('git',['config','--get-urlmatch','http.proxy','https://github.com/'],{encoding:'utf8'}).stdout?.trim();c.execSync('npx --yes --allow-remote=root --package=https://github.com/OpenMili/OpenMili-IP-Toolkit/archive/refs/heads/main.tar.gz?openmili='+Date.now()+' openmili-ip',{stdio:'inherit',env:{...process.env,...(p?{npm_config_https_proxy:p}:{})}})"
```

该命令通过 Node 调用系统命令行，兼容 Windows PowerShell 的脚本执行策略。无需 Git，也不需要发布到 npm；若本机已配置 Git 的 GitHub HTTP 代理，下载时会自动复用，不修改持久配置。`--allow-remote=root` 仅为本次命令允许直接指定的 GitHub 安装包，兼容限制远程包的新版 npm。时间戳查询参数避免同一个 main 下载地址长期复用旧版 npx 缓存；依赖仍可使用 npm 缓存。

1. 自动识别系统并获取本机 IPv4 / IPv6。
2. 输入 **1**：直接开始检测。
3. 输入 **2**：输入本地代理端口（默认 7890），或完整 `socks5h://127.0.0.1:10808` 地址，再开始检测。
4. 输出位于**执行命令时的目录** `openmili-reports/<时间>/report.html`，同目录包含 JSON 和异常页面截图。

“自定义端口”指**代理端口**，不是开放本机监听端口。无交互终端或使用 `--no-pause` 时默认直连。

首次浏览器检测优先使用本机 Edge / Chrome，缺失时下载 Chromium。Linux 若缺系统库，执行系统包管理器安装浏览器依赖，或在克隆仓库后运行 `npx playwright install --with-deps chromium`。失败的浏览器项目会标为未测试，HTTP 检测继续执行。

## 本地运行

蓝图补齐进度与边界见 [开发计划](docs/DEVELOPMENT_PLAN.md)；当前新增 P0 子命令和稳定报告协议：

```bash
node bin/openmili.js lookup --ip 8.8.8.8 --json
node bin/openmili.js port --host example.org --port 443 --tls --samples 3
node bin/openmili.js ip --ipv6
node bin/openmili.js doctor --offline
```

原生同语义入口：Windows `.\openmili.ps1`；Linux/macOS `sh ./openmili.sh`。`lookup` 只查指定 IP 的公开库，绝不启动网站/路由实测。`--redact` 适合分享报告，`--offline` 禁止网络查询。详情、配置、退出码与 schema 见 [CLI 协议](docs/CLI.md)。

```bash
npm ci
node bin/openmili.js
node bin/openmili.js --mode proxy --proxy socks5h://127.0.0.1:10808
node bin/openmili.js --mode direct --limit 5 --no-routes --no-pause
node bin/openmili.js --mode direct --family 6
node bin/openmili.js --lookup-ip 8.8.8.8 --only-lookup --no-pause
node bin/openmili.js --help
```

Windows 也可双击 `run.cmd` 或使用 `run.ps1`；Linux 可用 `bash run.sh`。这两个入口共用同一个检测核心，首次本地运行会自动 `npm ci`。

```powershell
.\run.ps1 -Mode proxy -Proxy socks5h://127.0.0.1:10808 -NoPause
.\run.ps1 -Mode direct -Limit 5 -NoBrowser -NoRoutes -NoPause
```

## 检测内容

| 模块 | 实际检查与边界 |
|---|---|
| 出口 IP | 多个 HTTPS 服务交叉观测 IPv4/IPv6，读取并标明 HTTP_PROXY/HTTPS_PROXY/NO_PROXY；可用 --ignore-env-proxy 禁用，显式代理覆盖 NO_PROXY。HTTP 开始/结束与浏览器开始/结束分别核验，出口变化或无法核验时不混入该 IP 评分。 |
| IP 属性 | RIPE RIS、Team Cymru 交叉核对 ASN/前缀，IANA 引导官方 RIR RDAP。仅有 ASN 时类型保持 UNKNOWN；按授权增强的 IP/前缀类型证据进行融合、依赖去重和冲突展示。 |
| DNS | 系统配置/getaddrinfo、UDP/TCP/DoH/DoT、A/AAAA/CNAME/MX/TXT/PTR 及正反向回查；保留 RCODE/耗时/差异，不把 CDN 差异当污染。 |
| 公开库风险 | 仅使用服务实际返回的 Tor、代理、VPN、滥用字段；免费服务省略字段或限流时保留未知。机房属性本身不扣分。 |
| 三网回程 | 有来源的北京、上海、广州三网九组双栈域名；DNS/BGP 归属核验、逐跳 ASN/RTT/匿名跳与健康历史，ICMP/TCP/UDP 按平台能力执行。城市仍需核实，不以 ASN 断言 CN2 GIA。 |
| IP 历史 | 官方 RIR RDAP 网段注册/修改事件、当前精确宣告前缀近 90 天 BGP 起源。不会把上级网段历史、BGP 变化或注册年龄当作滥用记录。 |
| 举报历史 | 设置环境变量 `ABUSEIPDB_API_KEY` 后查询近 90 天举报。未配置、无返回或无举报不证明没有滥用历史，密钥不写入报告。 |
| 网站实测 | 默认 38 个版本化分类目标，原始 HTTP、桌面浏览器请求头和真实 Chromium 三种方式。包含 ChatGPT、Claude、Scholar、Reddit、Grok、Quora、ScienceDirect 等验证目标，各站权重可调。 |
| 风控证据 | 区分验证码、CF 盾、地区限制、登录、429 限流、空白、JS 要求、网络错误；记录状态码、耗时、标题、可见文字片段、最终地址，异常浏览器页面截图。不会绕过验证码。 |
| 本地历史对比 | 与同一报告根目录的上一次相同出口报告比较网站结果；`latest.json` 保留最近一次完整报告。 |

回程是在**运行脚本的机器**上执行，不穿过 HTTP/SOCKS 代理。代理模式会跳过回程；需要测 VPS 回中国方向时，请在该 VPS 本机运行。Linux 需要系统 `traceroute`。不响应 ICMP 不等于线路差。

三网 IPv4/IPv6 分别测量；Windows 原生仅支持 ICMP，Linux 需 traceroute 及对应权限。见 [路由方法](docs/ROUTING_METHOD.md) 和 [站点规则](docs/WEBSITE_RULES.md)。

网站可达只证明本次页面访问。浏览器指纹、地区、账户、时间及代理按目标分流都会影响结果，不能保证“绝对好 IP”，也不代表登录、播放、支付已解锁。默认 HTTP 固定 IPv4，只有 IPv6 出口时改用 IPv6；直连浏览器若实际用了不同协议，其结果保留但不混入该 IP 评分。

直连 Chromium 通过临时本机回环桥固定所选 IPv4/IPv6；它只转发 TCP，不解密 TLS，退出即关闭。这样可避免浏览器优先 IPv6、HTTP 使用 IPv4 时混合两个 IP 的检测结果。

## 综合评分

P1 数据源默认免 Key；`--community-sources`、`IPAPI_API_KEY`、`IPINFO_TOKEN` 按授权开启增强类型库。缓存、隐私、配额与来源许可见 [API 说明](docs/API_PROVIDERS.md)，分类规则见 [证据融合](docs/CLASSIFICATION_RULES.md)，DNS 见 [协议检测](docs/DNS.md)。

| 维度 | 权重 |
|---|---:|
| 信誉与风险 | 30 |
| 网站实际访问 | 25 |
| 三网路径 | 20 |
| DNS 健康 | 15 |
| IP 网络基础能力 | 10 |

未知项重新归一化，同时显示有效覆盖率；不足 60% 不提供综合等级。类型与注册年龄不计分，每项结果有实际证据引用。模型权重、状态因子与等级阈值可配置；报告保存标准化输入和完整模型，支持 `score --input report.json --json` 离线重放。见 [评分公式](docs/SCORING.md)。

终端支持单项菜单、重试、中英文、NO_COLOR、窄屏和 JSON；报告包含离线单文件 HTML（主题、图表、逐跳与内嵌截图）、JSON、Markdown、TXT、ANSI。详见 [报告与终端](docs/REPORTS.md)。

## 自定义目标与选项

`domains.yaml` 支持 `name`、`url` 和可选 `weight`（1–3），重复 URL 去重，不接受别名、凭据和非 HTTP/HTTPS URL：

```yaml
domains:
  - name: Google Scholar
    url: https://scholar.google.com/
    weight: 3
```

```bash
node bin/openmili.js --urls domains.yaml --output ./my-reports
node bin/openmili.js --targets-url https://example.com/domains.yaml
node bin/openmili.js --port 7890 --no-browser
node bin/openmili.js --no-install-browser --browser-path /usr/bin/chromium
node bin/openmili.js --headed --screenshots
```

`--targets-url` 上限 100 KiB，下载只驻留内存。所有 HTTP 请求有超时、大小上限和重定向上限，并验证 TLS；不使用 `curl -k`。截图与报告仅写在本机。截图可能包含访问页面内容，请按需保管。

## 验证

```bash
npm test
npm run smoke
npm pack --dry-run
```

回归覆盖 HTTP/浏览器误判、JavaScript 渲染、代理 `NO_PROXY`、重定向最终响应头、YAML、IPv4/IPv6、公网校验、回程解析、ASN 冲突、历史前缀过滤、缺失证据评分和报告转义。GitHub Actions 配置 Windows/Linux、Node 20/24 矩阵，测试时安装真实 Chromium。

backtrace 参考和 MIT 许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
