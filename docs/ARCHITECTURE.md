# 架构与证据边界

选择 Node.js 20+，保留系统 curl 作为可绑定、可验证 TLS 的 HTTP 传输。系统、socket、隐私、schema、配置、属性、路由、浏览器和报告分模块，两个平台入口只负责依赖检查与参数转发。

```
openmili.ps1 / openmili.sh / npm bin
  -> cli-options（严格参数、配置合并）
  -> system（只读环境、严格来源绑定）
  -> identity / routes / port / HTTP / browser
  -> score -> schema -> privacy -> 本地报告
```

1. 查询模式只使用公开数据，不执行目标网站或路径检测；查询目标的 family 与 API 传输 family 独立。
2. 本机/代理真实出口由独立 HTTPS 源观测；“观察到 IP”和“稳定核验”分别记录。HTTP 起止均须满足多源核验才归因计分。
3. 所有外部进程使用参数数组与 shell:false，超时、输出大小与 AbortSignal 有界。HTTP 不使用 `-k`。
4. 绑定先验证地址属于本机，再传给 curl/socket/浏览器转发桥；不支持绑定的路由测量明确跳过。
5. 浏览器跨站新建无登录 context；family bridge 只在回环地址监听，不解密 TLS。
6. 报告保留标准模块状态与原始来源证据。保存前校验 JSON Schema，再统一删减响应头、过滤密钥与凭据；分享模式额外隐藏 IP/主机名并禁用截图。
7. UNKNOWN 与 SKIPPED 不算网络故障，也不获得满分；lookup/port 模式不生成出口综合等级。

正式安装包、远程 Agent 与数据源/评分版本隔离将在对应阶段扩充；此文不意味着 P1–P4 已完成。
