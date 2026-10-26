# OpenMili IP Toolkit

检测**运行本机或指定代理的真实出口 IP**：公开库与 ASN、三网回程、IP 历史、网站 HTTP 和真实 Chromium 风控检测，最后生成中文 HTML / JSON 报告。

## 一条通用命令

先安装 [Node.js 20+ LTS](https://nodejs.org/)（含 npm/npx），系统需有 curl。在 **Windows CMD、PowerShell、Linux Bash** 中输入同一条命令，从本 GitHub 仓库下载运行：

```text
node -e "const c=require('child_process'),p=c.spawnSync('git',['config','--get-urlmatch','http.proxy','https://github.com/'],{encoding:'utf8'}).stdout?.trim();c.execSync('npx --yes --allow-remote=root --package=https://github.com/OpenMili/OpenMili-IP-Toolkit/archive/refs/heads/main.tar.gz openmili-ip',{stdio:'inherit',env:{...process.env,...(p?{npm_config_https_proxy:p}:{})}})"
```

该命令通过 Node 调用系统命令行，兼容 Windows PowerShell 的脚本执行策略。无需 Git，也不需要发布到 npm；若本机已配置 Git 的 GitHub HTTP 代理，下载时会自动复用，不修改持久配置。`--allow-remote=root` 仅为本次命令允许直接指定的 GitHub 安装包，兼容限制远程包的新版 npm。命令使用 `main` 当前版本；安装包及依赖会缓存到 npm 用户缓存。

1. 自动识别系统并获取本机 IPv4 / IPv6。
2. 输入 **1**：直接开始检测。
3. 输入 **2**：输入本地代理端口（默认 7890），或完整 `socks5h://127.0.0.1:10808` 地址，再开始检测。
4. 输出位于**执行命令时的目录** `openmili-reports/<时间>/report.html`，同目录包含 JSON 和异常页面截图。

“自定义端口”指**代理端口**，不是开放本机监听端口。无交互终端或使用 `--no-pause` 时默认直连。

首次浏览器检测优先使用本机 Edge / Chrome，缺失时下载 Chromium。Linux 若缺系统库，执行系统包管理器安装浏览器依赖，或在克隆仓库后运行 `npx playwright install --with-deps chromium`。失败的浏览器项目会标为未测试，HTTP 检测继续执行。

## 本地运行

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
| 出口 IP | 多个 HTTPS 服务交叉观测 IPv4/IPv6，忽略系统隐式代理；显式代理会覆盖 `NO_PROXY`。HTTP 开始/结束与浏览器开始/结束分别核验，出口变化或无法核验时不混入该 IP 评分。 |
| IP 属性 | ipwho.is、ipapi.is、RIPE RIS 交叉核对 ASN；先按所有者名称推断，再按内置 ASN 映射复核。运营商 ASN 可能混用住宅、企业、机房，不直接认定住宅；来源冲突显示待定。 |
| 公开库风险 | 仅使用服务实际返回的 Tor、代理、VPN、滥用字段；免费服务省略字段或限流时保留未知。机房属性本身不扣分。 |
| 三网回程 | 参考 backtrace 的北京、上海、广州、成都三网共 12 个目标；系统 tracert/traceroute 获取跳点，RIPE 验证沿途 ASN，前缀提示另标。不会仅靠 59.43 就认定 CN2 GIA。 |
| IP 历史 | RDAP 网段注册/修改事件、当前精确宣告前缀近 90 天 BGP 起源。不会把上级网段历史、BGP 变化或注册年龄当作滥用记录。 |
| 举报历史 | 设置环境变量 `ABUSEIPDB_API_KEY` 后查询近 90 天举报。未配置、无返回或无举报不证明没有滥用历史，密钥不写入报告。 |
| 网站实测 | 默认 35 个目标，原始 HTTP、桌面浏览器请求头和真实 Chromium 三种方式。包含 ChatGPT、Claude、Scholar、Reddit、Grok、Quora、ScienceDirect 等验证目标，各站权重可调。 |
| 风控证据 | 区分验证码、CF 盾、地区限制、登录、429 限流、空白、JS 要求、网络错误；记录状态码、耗时、标题、可见文字片段、最终地址，异常浏览器页面截图。不会绕过验证码。 |
| 本地历史对比 | 与同一报告根目录的上一次相同出口报告比较网站结果；`latest.json` 保留最近一次完整报告。 |

回程是在**运行脚本的机器**上执行，不穿过 HTTP/SOCKS 代理。代理模式会跳过回程；需要测 VPS 回中国方向时，请在该 VPS 本机运行。Linux 需要系统 `traceroute`。不响应 ICMP 不等于线路差。

当前三网目标为 IPv4；选择 IPv6 检测时，该模块标为未测试，不混入 IPv6 评分。

网站可达只证明本次页面访问。浏览器指纹、地区、账户、时间及代理按目标分流都会影响结果，不能保证“绝对好 IP”，也不代表登录、播放、支付已解锁。默认 HTTP 固定 IPv4，只有 IPv6 出口时改用 IPv6；直连浏览器若实际用了不同协议，其结果保留但不混入该 IP 评分。

直连 Chromium 通过临时本机回环桥固定所选 IPv4/IPv6；它只转发 TCP，不解密 TLS，退出即关闭。这样可避免浏览器优先 IPv6、HTTP 使用 IPv4 时混合两个 IP 的检测结果。

## 综合评分

| 维度 | 权重 |
|---|---:|
| HTTP 桌面请求实测 | 30 |
| 真实 Chromium 页面实测 | 40 |
| 公开库风险记录 | 20 |
| 三网路径可观测性 / 到达情况 | 10 |

网站按 `weight` 加权：可达 100%、登录 65%、验证码 20%、429 限流 25%、拦截/网络失败 0%；JS 要求及未测试属于未知。回程收到跳点但没到终点计该节点 50%，无跳点为未知。公开库风险使用实际存在字段的覆盖比例，Tor/滥用风险为 100%、公开代理 60%、VPN 30%，可选举报风险取较高值。

报告展示**已获得分数 / 100、证据覆盖率、可能分数范围**，未测项不计满分。只有覆盖率至少 70%、至少 5 个站点且浏览器已测权重达到 20 分时才给出本次样本等级；等级按已测部分比例计算。ASN 类型及历史注册年龄不直接加减分。

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
