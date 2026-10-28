# OpenMili-IP-Toolkit

两个独立的 IP 检测脚本：Windows PowerShell、Linux Shell。无需 Node.js、npm、Python 或浏览器。结果直接显示在终端，临时文件结束后清理。

## 一行运行

Windows（PowerShell 5.1 / 7）：

```powershell
irm https://raw.githubusercontent.com/OpenMili/OpenMili-IP-Toolkit/main/openmili.ps1 | iex
```

Linux：

```sh
curl -fsSL https://raw.githubusercontent.com/OpenMili/OpenMili-IP-Toolkit/main/openmili.sh | sh
```

首页显示名称、GitHub 地址、直连公网 IPv4 / IPv6。输入 `1` 开始，输入 `2` 设置代理端口或 HTTP / SOCKS5 地址。

## 检测内容

- **公网出口**：通过 curl 查询 IPv4、IPv6 专用回显地址，不把网关或内网地址当作公网 IP。
- **ASN / 归属**：按取得的公网 IP 查询 ipwho.is、ipinfo.io、IP.SB，来源不可用时自动切换，并核对返回 IP；云商归属只标注机房倾向，不能据此确认住宅属性。
- **三网延迟**：对原版 12 个节点分别发送两次 ICMP，按城市列出电信、联通、移动的目标回复延迟，不使用中间路由跳点代替目标。
- **网站访问**：分别通过 IPv4、IPv6，使用 curl 加 Chrome 请求头，检查 HTTP 状态、返回正文、验证码、地区限制和拒绝信息。AI、流媒体、社区分类展示，边测边输出。
- **三网回程**：参考 [zhanghanyun/backtrace](https://github.com/zhanghanyun/backtrace) 的探测思路和原版 12 个节点；分别执行 ICMP、TCP 443 逐跳探测，同表对比各自的到达情况和线路特征，按北京、上海、广州、成都排列。
- **结束核验**：复查公网出口，提示检测期间是否变化。
- **访问参考分**：每个协议族分别统计，已测项按通过 1、待核 0.5、失败 0 计算百分制；未知不计，少于 8 项明确观测时显示证据不足。这不是风险库或 IP 纯净度评分。

颜色：绿＝页面通过，黄＝验证 / 登录 / 待确认，红＝阻断 / 网络失败，灰＝没有该协议族 / 未执行。

终端使用横线分区：硬件与时间、IP 基础信息、三网延迟、分类网站检测、双协议回程、综合评估。只检测可用的协议族；双栈分别成表，窄屏改为分类列表并自动换行。

网站页面可访问不等于账号、订阅或视频播放解锁；浏览器请求头不会执行 JavaScript。代理按目标分流仍可能使用不同出口。三网路径只测本机直连，代理模式跳过；线路前缀是提示，不据此宣称 CN2 GIA 或线路等级。

## 本地运行

```powershell
Get-Content .\openmili.ps1 -Raw -Encoding UTF8 | iex
```

PowerShell 7 也可直接运行 `.\openmili.ps1 -Direct -NoPause`，或加 `-Proxy 10808` / `-Proxy socks5h://127.0.0.1:10808`。Windows PowerShell 5.1 使用上面的 UTF-8 读取方式。

```sh
sh openmili.sh --direct
sh openmili.sh --proxy 10808
sh openmili.sh --proxy socks5h://127.0.0.1:10808
```

Windows 使用系统自带 `curl.exe` 和 .NET 网络接口。TCP 逐跳接收 ICMP 回包需要管理员权限，普通权限仍可执行 ICMP 检测，TCP 会明确标注未执行。

Linux 需要 `curl`；ICMP 使用 `traceroute -I` 或系统 `ping`，TCP 使用 `traceroute -T -p 443`。TCP 通常需要 root 或相应 raw socket 权限。缺少工具或权限会明确提示，不自动修改系统。两种协议独立检测、独立判定，TCP 不再只是 ICMP 失败时的备用方式。

用 `-Help`（Windows）或 `--help`（Linux）查看跳过延迟与回程、超时和无颜色选项。

## 许可

[MIT](LICENSE) · [回程参考代码说明](THIRD_PARTY_NOTICES.md)
