# 三网路径方法

`route --ipv4|--ipv6 --isp all --region beijing,shanghai,guangzhou` 使用有来源的九组运营商双栈域名，来源、版本、ASN 范围见 `data/route-nodes.json`。每次解析后核对当前 BGP 起源；归属冲突时停止该节点。城市名称来自上游目录，不能作为已证实的物理位置。

北京电信 IPv6 当前解析到 AS58540，其持有者登记为 Jinan IDC；保留显著地理警告，不把“北京”或 ASN 注册地当作定位结论。DNS/BGP 核对成功与探测可达分别记录，只有实际到达目标才写入成功时间。用户缓存 `route-health.json` 保留双栈记录及最近十次观测。

默认 ICMP 未到达后尝试 TCP/UDP，`--route-protocols icmp,tcp,udp` 可指定。Linux 使用 traceroute；Windows 原生 tracert 只支持 ICMP，TCP/UDP 和 IPv4 来源绑定均标不支持。无权限/工具缺失不会换成虚构结果或绕过代理。macOS 适配尚未实机验证。

每跳保留地址、多地址、星号、实际 RTT 样本与 RIPE ASN 证据；`<1ms` 是上界，不虚构精确数。目标 ASN 不参与中转骨干判定。混合骨干与跨网只按实测 hop 标注；没有地理证据时绕路未知，单次路径不宣称 CN2 GIA 或链路丢包率。

发起地未核实，默认写“本机出站路径（回程方向未核实）”。`--origin-country CN` 明确为本机去程；其他国家也只作为用户声明，不能证明远端位置、双向对称或全部省份。

代理模式不会执行本机 traceroute 充当代理回程。要测 VPS，请在该 VPS 或获授权 Agent 上运行。
