#!/usr/bin/env python3
"""Store the user's Gitee publisher token in macOS Keychain, never in the project."""
import getpass,json,subprocess,urllib.request
print('Mathdraw Gitee 发布配置')
print('请先在 Gitee 私人令牌页面创建仅 projects 权限的令牌。')
print('令牌用于 liu_chuanning/mathdraw 的安装包发布，将保存到本机钥匙串。')
try:
    token=getpass.getpass('粘贴令牌（不显示输入）：').strip()
    if not token: raise ValueError('未输入令牌')
    request=urllib.request.Request('https://gitee.com/api/v5/user',headers={'Authorization':'Bearer '+token})
    with urllib.request.urlopen(request,timeout=15) as response: user=json.load(response)
    if user.get('login')!='liu_chuanning':raise ValueError('令牌不属于 liu_chuanning，请检查登录账号')
    subprocess.run(['/usr/bin/security','add-generic-password','-U','-a','liu_chuanning','-s','lab.chuan.mathdraw.gitee-publish','-w',token],check=True,capture_output=True)
    print('配置完成。令牌没有写入项目文件。')
except Exception as e:
    print('配置未完成：'+(str(e) if isinstance(e,ValueError) else '无法验证令牌或写入钥匙串，请检查权限与网络。'))
input('按回车关闭窗口…')
