# 安装、更新、回滚和卸载

源码与npx命令需要Node20+、npm和系统curl；默认不安装浏览器。便携Releases另外附带Node运行时、npm、生产依赖、各组件许可证以及runtime-manifest，解包即可运行，不需要全局Node或编译器。

下载并检查本仓库 `install.sh` / `install.ps1` 源码后执行：

```text
sh install.sh --version v2.4.0
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Version v2.4.0
```

脚本检测系统/架构，从指定GitHub Release获取相应包及SHA256SUMS，先校验，再拒绝路径越界/符号链接/特殊文件后解包。默认用户目录安装，无需管理员，不改PATH或系统网络配置。Linux/macOS可用 `--root DIR`，Windows用 `-InstallRoot DIR`。输出绝对启动路径。也可手动核验SHA后解包并用包内node执行CLI。

管理安装目录包含versions/版本、启动器、current.txt与专属元数据。新版本校验并离线自检成功后才激活；原版本保留。运行安装根目录启动器的 `update` 获取最新稳定Release，`rollback`重新激活上一版本。元数据与目录不符、下载/校验/自检失败、平台无包时保留旧版；同版本不覆盖。源代码/npx运行请重新获取main，不用update覆盖仓库。

`uninstall --yes`只删除本工具元数据登记的版本和启动器，保留不认识的用户文件、配置、密钥和报告；Windows正在运行的便携node退出后才执行后台隐藏清理。`--purge-cache`额外删除专属API/节点缓存。不会删除系统Node/npm/curl/浏览器、DNS、防火墙规则或Git源码。源码目录执行uninstall返回SKIPPED。

正式便携构建目标：Linux glibc x64/ARM64、Windows x64、macOS runner原生架构；原生便携全流程已验证，正式附件以对应Release/Actions为准。Debian、Fedora、Rocky9、Alma9、Arch、RHEL UBI9另有核心容器CI；容器验证不等于每个宿主系统/版本均已实机测试。Windows ARM64可用系统Node的源码命令，尚无原生便携包。Alpine/musl使用发行版Node/npm/curl的源码入口；glibc二进制不能在musl直接运行。Rocky/RHEL等需满足所含Node运行时glibc要求；没有逐发行版实机证据时不宣称全部验证。

`websites --mode browser` / `all --browser`按需加载独立Playwright worker，优先本机Chrome/Edge，缺少时可下载Chromium；`--no-install`禁止下载。Linux浏览器系统库仍需用户通过发行版包管理器安装，工具不会擅自sudo。worker缓存和系统浏览器分开，退出时清理临时会话。
