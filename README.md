# OpenMili IP 检测

Windows、Linux、macOS 命令行检测工具。检查当前直连或 HTTP/SOCKS5 代理出口 IP、网站可达性；可选在线 IP 数据库查询和三网路由跟踪。无需下载执行第三方脚本。

## 快速运行

Windows：

```powershell
.\run.ps1 -Mode direct -Lookup -ReturnRoutes -NoPause
.\run.ps1 -Mode proxy -Proxy socks5h://127.0.0.1:10808 -Lookup -NoPause
```

也可双击 `run.cmd`。Linux/macOS：

```bash
chmod +x run.sh
./run.sh --mode direct --lookup --return-routes --no-pause
./run.sh --mode proxy --proxy socks5h://127.0.0.1:10808 --lookup --no-pause
```

默认读取随仓库提供的 `domains.yaml` 中 14 个目标。`-Limit 5` / `--limit 5` 只检测前五个。`-SkipIP` / `--skip-ip` 跳过出口 IP，此时 IP 数据库查询会标记为未测试。未指定模式时交互选择；重定向输入或指定 `NoPause` 时默认直连。

## 下载清单、检测、清理

可用 HTTPS 地址临时下载目标清单，检测结束或报错后自动删除临时文件：

```powershell
.\run.ps1 -Mode direct -TargetsUrl https://example.com/domains.yaml -NoPause
```

```bash
./run.sh --mode direct --targets-url https://example.com/domains.yaml --no-pause
```

清单格式：

```yaml
domains:
  - name: ChatGPT
    url: https://chatgpt.com/
  - name: 'Google Scholar'
    url: 'https://scholar.google.com/'
```

使用两格列表缩进、四格字段缩进。支持普通文本、单/双引号字符串、空行及 `#` 注释；仅接受上述 `domains`、`name`、`url` 结构，不支持 YAML 锚点、多行字符串等扩展语法。重复 URL 自动去重。双引号内支持转义引号及反斜杠。自定义文件用 `-Urls domains.yaml` / `--urls domains.yaml` 指定。

下载大小上限 100 KiB。运行结束自动清理临时文件。

## IP 与三网回程

- `Lookup` / `--lookup` 查询在线 IP 数据库的国家、城市、运营商及 ASN。Windows 使用 [ipwho.is](https://ipwho.is/)，Linux/macOS 使用 [ipinfo.io](https://ipinfo.io/)；不需要本地数据库。
- `-LookupIP 8.8.8.8` / `--lookup-ip 8.8.8.8` 可查指定 IP，并自动启用数据库查询。
- 只查数据库：`.\run.ps1 -LookupIP 8.8.8.8 -OnlyLookup -NoPause` 或 `./run.sh --lookup-ip 8.8.8.8 --only-lookup --no-pause`。
- `ReturnRoutes` / `--return-routes` 使用系统的 `tracert` / `traceroute` 从**运行本机**到电信、联通、移动参考 IP 测路。Linux/macOS 需要安装 `traceroute`。可用 `-RouteTargets '电信=202.96.209.133','联通=123.125.81.6','移动=211.136.112.50'` 或 `--route-targets '电信=202.96.209.133 联通=123.125.81.6 移动=211.136.112.50'` 替换目标。
- HTTP/SOCKS5 代理不承载系统路由跟踪；代理模式会显示“三网回程: 未测试”。路由结果只反映当前主机到参考目标的路径，不能单凭它认定 CN2、9929 等线路类型。

“服务可达”只表示本次 HTTP 请求获得非空的成功响应，不代表账户登录、流媒体播放或服务完整解锁。超时、验证码、Cloudflare Challenge、地区限制及访问受限分别报告。

## 上传 GitHub

本地回归测试：`node tests/smoke.js`。Windows 同时测试 Git Bash 时设置 `TEST_BASH` 为 `bash.exe` 的完整路径。

目录可直接作为仓库上传。创建空仓库后，在本目录执行：

```bash
git remote add origin <你的仓库地址>
git branch -M main
git push -u origin main
```
