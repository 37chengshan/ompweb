# omp-web 常用命令速查

## 发布

### npm 发布(手动,CI OIDC 未授权时用)

```bash
# 确认登录官方源(本地 registry 常指向 npmmirror,发布必须官方源)
npm whoami --registry=https://registry.npmjs.org

# 发布(prepack 自动 build;需要 2FA 一次性码时加 --otp=XXXXXX)
npm publish --registry=https://registry.npmjs.org --access public

# 验证
npm view @37chengshan/ompweb@<version> version --registry=https://registry.npmjs.org
```

### 发布前 bump 版本

```bash
node -e "
const fs=require('fs');
const p=JSON.parse(fs.readFileSync('package.json','utf8'));
p.version='<version>'; // 例 4.0.10
fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');
const l=JSON.parse(fs.readFileSync('package-lock.json','utf8'));
l.version=p.version; l.packages[''].version=p.version;
fs.writeFileSync('package-lock.json',JSON.stringify(l,null,2)+'\n');
"
```

### 桌面三平台打包 + GitHub Release + npm(CI)

```bash
# 打 tag 即触发:Build desktop app(三平台→Releases)+ Publish npm package(OIDC 失败时手动发)+ CI
git tag v<version> && git push origin v<version>

# 查 CI
gh run list --limit 3
```

### 桌面包手动本地打包

```bash
npm run build          # 产出 .next/standalone(必须先 build)
npm run desktop:build  # electron-builder --mac → dist-desktop/*.dmg
```

## 开发

```bash
npm run dev            # dev server,127.0.0.1:30178
npm run dev:lan        # 0.0.0.0:30178(LAN 可访问)
npm run start          # next start,127.0.0.1:30177
npm run desktop:start  # Electron 桌面 app(0.0.0.0:30179,含 splash)
```

## 验证

```bash
npm test               # 全量 node:test(约 485 个)
npx tsc --noEmit       # 类型检查(lib/github.ts 既有报错忽略)
npm run lint           # eslint
```

## 远程配对验证(curl)

```bash
# 生成 token(loopback;QR 指向物理网卡 IP)
curl -s -X POST http://127.0.0.1:30178/api/pair/token | jq

# 模拟手机 accept(写 Cookie)
TOKEN=$(curl -s -X POST http://127.0.0.1:30178/api/pair/token | jq -r .token)
curl -s -D /tmp/ph.txt -X POST http://127.0.0.1:30178/api/pair/accept \
  -H "Content-Type: application/json" -H "User-Agent: Mozilla/5.0 (iPhone)" \
  -d "{\"token\":\"$TOKEN\",\"mobile\":true}"
COOKIE=$(grep -io "dsh_pair=[^;]*" /tmp/ph.txt | head -1)

# 门控:远程 Host 无 Cookie 401、带 Cookie 200;/remote 页面豁免 200
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: 192.168.1.50:30178" http://127.0.0.1:30178/api/sessions
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: 192.168.1.50:30178" -H "Cookie: $COOKIE" http://127.0.0.1:30178/api/sessions
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: 192.168.1.50:30178" http://127.0.0.1:30178/remote

# 诊断(物理网卡 IP / 端口 / Windows 防火墙规则)
curl -s http://127.0.0.1:30178/api/pair/diagnostics | jq
```

## 数据接口

```bash
# 用量(token 今日/周/月/总,90 天窗口)+ 各账号限额
curl -s http://127.0.0.1:30178/api/usage-summary | jq
curl -s http://127.0.0.1:30178/api/provider-usage | jq

# omp 更新
curl -s -X POST http://127.0.0.1:30178/api/omp-update -H "Content-Type: application/json" -d '{"action":"check"}'
curl -s -X POST http://127.0.0.1:30178/api/omp-update -H "Content-Type: application/json" -d '{"action":"update"}'
```

## Windows 防火墙放行(手机连不上时)

```powershell
# 管理员 PowerShell(端口按实际:dev 30178 / CLI 30177 / 桌面 30179)
netsh advfirewall firewall add rule name="OmpWeb-30179" dir=in action=allow protocol=TCP localport=30179
```

## 常见问题排查

| 症状 | 检查 |
|---|---|
| 手机扫 QR 打不开 | ① 电脑上 `curl http://<电脑IP>:<端口>/remote` 是否 200;② 防火墙规则;③ 手机与电脑同一子网(勿开 AP 隔离) |
| 桌面 app 启动即消失 | 端口被占(30179)→ 弹窗提示,关闭占用程序 |
| 视频播完黑屏/白屏 | 已修为 logo 启动层;若仍出现看 `omp-app.log` 有无 `splash warm` |
| CI npm 发布红叉 | OIDC 未授权 → 手动 `npm publish --registry=https://registry.npmjs.org --access public` |
