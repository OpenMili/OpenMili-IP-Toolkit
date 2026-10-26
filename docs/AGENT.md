# 授权 SSH Agent

远端先由主机所有者安装本工具并确认SSH授权、主机密钥可信；客户端需要系统ssh。Agent复用现有SSH，不开放新的监听端口，不自动部署，不接受任意shell命令。

```text
node bin/openmili.js agent --ssh user@vps.example --remote-path /home/user/.local/share/openmili-ip/openmili-ip --task all --json
node bin/openmili.js agent --ssh user@vps.example --remote-path /home/user/.local/share/openmili-ip/openmili-ip --task route --ipv6
```

可用 `--ssh-port`、`--ssh-key`、`--known-hosts`、`--agent-timeout 900`（秒）。使用 BatchMode、StrictHostKeyChecking=yes；不自动接纳新密钥。请先通过自己的可信渠道建立 known_hosts。远端POSIX路径与任务/参数均严格限制并逐项shell引用，拒绝SSH选项注入。

报告按schema验证后保存为mode=agent，保留远端环境、实际出口和各模块证据；SSH目标及接收时间单独记录。本机不会替代远端探测。远端仍在自己的目录保存报告。`--redact`传到远端，同时在本地脱敏；无需把API Key传给客户端，在授权远端自己的环境配置即可。

SSH中断、stdout混入banner、schema无效或远端失败会明确报错，不静默切换到本机。当前远端适配为Linux/macOS POSIX SSH主机；不声称已适配Windows SSH默认shell。
