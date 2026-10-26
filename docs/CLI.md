# 命令行与报告协议（P0）

Windows 原生：`powershell -ExecutionPolicy Bypass -File .\openmili.ps1 lookup --ip 8.8.8.8 --json`。
Linux/macOS：`sh ./openmili.sh lookup --ip 8.8.8.8 --json`。两入口传递相同参数；旧 run.ps1 参数格式继续兼容。

- `all`：现有完整检测流程。`ip` 仅系统/出口；`identity`、`reputation` 仅当前出口公开库；`lookup --ip` 仅指定目标公开库与历史。
- `port --host example.org --port 443 --tls --samples 3`：实际 TCP/可信 TLS 诊断；不会把 TCP 可连称为应用可用。`--port N` 无 port 子命令时仍表示旧版代理端口。
- `doctor`：本地依赖/系统诊断，不修改网络配置。
- `--interface NAME` / `--source-ip IP`：必须是本机所选协议族地址；不支持与代理混用，失效即停止。curl 记录实际 localIP 与 bindingVerified；浏览器连接桥同样绑定。不能保证绑定的路由工具明确跳过。
- `--ipv4` / `--ipv6`，`--timeout 1..120`（秒），`--samples 1..10`。
- `--offline`：所有网络探测停止，保留本地环境与未执行原因。`--no-install`：启动器不安装依赖/浏览器。后续 P1 增加 TTL 缓存读取。
- `--config FILE`：无别名/重复键的 YAML，键使用 CLI 参数名（去除 `--`）；命令行值覆盖配置。拒绝未知键与不正确类型。
- `--json`：stdout 只输出一份完整 JSON；诊断错误在 stderr。`--output report.json` 同时保存指定 JSON 文件和时间戳目录内 HTML/JSON。
- `--redact`：IP/本地主机名打码，关闭截图；密钥、Cookie、认证头、代理凭据、敏感 URL 参数无论是否指定该开关都会过滤。

JSON 以 `schema_version:1.0.0`、`tool_version`、`target`、`modules`、`scores`、`errors` 为稳定字段。保留旧版字段以兼容现有消费方。`modules.*` 使用 success/limited/failure/unknown/skipped 及 code/reason/checked_at，源证据另存。CI 使用 Ajv 严格校验 `schemas/report-v1.schema.json`。查询目标与 exit_ip 分开；lookup 的 exit_verified 始终 false。

退出码：0 完成（可含 UNKNOWN），2 参数/初始化错误，3 目标端口诊断失败，130 用户中断。Ctrl+C 关闭活动子进程/浏览器，尽可能保存完成部分；不能把未知数据写成成功。

当前 `--language`、`--concurrency`、`--retries` 预留配置已校验；语言渲染/调度策略由后续阶段补齐。它们尚不代表对应阶段已验收。
