# 蓝图交付与验收记录

依据：2026-10-27《OpenMili-IP-Toolkit-Development-Blueprint.md》。审查基线：1037879。

沿用 Node.js 20+ 模块化内核：系统与 TCP/TLS 使用标准库，HTTP 使用系统 curl；浏览器增强独立按需加载。无需 Go 编译器。发布包与源码安装均保留相同的检测语义。

阶段只有在代码、回归、文档和可复现证据齐全时才通过；自动化 fixture 与真实网络观测分别记录，缺少环境不能写成验收通过。

| 阶段 | 必须交付 | 状态 |
|---|---|---|
| P0 | 跨平台入口、子命令/配置/状态/退出码、系统环境、双栈出口、隔离 lookup、TCP/TLS port、JSON Schema、Windows/Linux 冒烟 | 基座回归通过；ce9f0a1 的四组 CI 成功，补丁持续复验 |
| P1 | RIPE/Cymru/官方 RDAP、多源证据融合、独立风险、DNS UDP/TCP/DoH/DoT、代理核验、TTL/退避/离线 | 已完成；38 项回归通过，370a726 的 Windows/Linux × Node20/24 CI 全通过，外部 DoT 不可达如实标未知 |
| P2 | 有来源且有健康记录的目标目录、双栈多协议路由/完整跳点/方向、版本化分类站点规则与协议错误 | 实现完成，本机 44 项回归通过；18/18 DNS+BGP 归属核对、Windows 路由与 38 站 HTTP 实测完成，待 Linux 协议 CI 确认 |
| P3 | 配置化多维评分/覆盖率/重放、交互菜单/进度/重试/语言、JSON/HTML/Markdown/TXT 与隐私 | 待完成 |
| P4 | 浏览器按需、授权 Agent、ARM64/平台验证、校验安装/升级回滚/安全卸载、Release、安全与中英文文档 | 待完成 |

## 必须维持的约束

- 查询目标、实际出口、传输 IP 协议族分别保存；任意 IP 查询不会冒充通过该 IP 的网站检测。
- 来源不足、冲突、离线、权限不足和规则过期均允许 UNKNOWN/SKIPPED，不伪造成功。
- ASN 及所有者字符串只能是弱证据；网络类型与信誉风险分开。
- 网站 HTTP 200、单次 traceroute 或单库无记录不代表绝对纯净、可注册、CN2 GIA。
- 敏感信息在日志/报告边界统一过滤；分享脱敏模式不保存页面截图。
- 每阶段验证记录置于 docs/evidence/；实际未测平台保留未验证状态。

## 验收追踪

覆盖蓝图 §17 的 15 项：平台安装；双栈/断网/DNS 异常；安全 lookup；绑定/代理/Agent 出口；多源类型；独立风险；路由与方向；网站状态；200/403/429；schema/离线 HTML/隐私；API 降级；评分重放；Ctrl+C/权限/窄屏/无色；安全卸载；CI/Release/校验和/许可。

完整差距报告：`C:\Users\Hmily\Downloads\OpenMili-IP-Toolkit-Blueprint-Gap-Analysis-2026-10-27.md`。该文件是基线审计，后续进度以本文件和实测记录为准。
