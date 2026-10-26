# 第三方参考与许可

三网参考 IP 列表和旧式 IP 前缀提示参考 [zhanghanyun/backtrace](https://github.com/zhanghanyun/backtrace)。本项目使用系统 traceroute/tracert，另外查询 RIPE ASN，不包含上游 raw socket 跟踪实现。ASN 前缀提示不能单独证明线路等级。

MIT License

Copyright (c) 2022 zhy

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
# NextTrace endpoint directory

`data/route-nodes.json` selects the publicly documented Beijing/Shanghai/Guangzhou operator endpoint domain names from NextTrace's `fast_trace/basic.go`, blob `a78c7d50cb4c5dbfefbb69db5803c6abb9405e34`, retrieved 2026-10-27. The separate directory is supplied under the upstream GPL-3.0-only license; full terms are in `data/licenses/NextTrace-GPL-3.0.txt`. Source: https://github.com/nxtrace/NTrace-core/blob/main/fast_trace/basic.go. NextTrace contributors retain their rights.

The toolkit's traceroute orchestration/parser was independently implemented. No NextTrace application code is linked or copied. The upstream directory does not imply endpoint health or permission to claim a commercial line class; DNS, BGP ownership and actual reachability are recorded separately.
