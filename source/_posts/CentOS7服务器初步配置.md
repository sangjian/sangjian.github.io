---
title: CentOS7服务器初步配置
date: 2016-08-01 00:01:31
tags:
- CentOS
- SSH
categories: 
- 服务器
---
在开发或者部署网站的时候，需要自己配置Linux服务器，本文以Centos7为例，记录了配置Linux服务器的初步流程

## 第一步：root用户登录

使用root用户登录远程主机（假定IP地址为192.168.1.125）

```bash
ssh root@192.168.1.125
```
这时，会出现警告，提示这是一个新的地址，存在安全风险。接收则输入yes

{% asset_img -----2016-08-22---10-30-13.png %}

<!-- more -->

登录远程主机之后修改root密码

```bash
passwd
```

## 第二步：新建用户

添加一个用户组admin

```bash
groupadd admin
```

然后，添加一个新的用户

```bash
useradd -d /home/sangjian -s /bin/bash -m sangjian
```

上面命令中，参数d表示指定用户的主目录，参数s指定用户的shell，参数m表示如果该目录不存在，则创建该目录。


设置新用户的密码。

```bash
passwd sangjian
```
将sangjian添加到用户组admin中

```bash
usermod -a -G admin sangjian
```
为sangjian用户设定sudo权限

```bash
visudo
```
visudo命令会打开文件/etc/sudoers，找到如下一行

```bash
root    ALL=(ALL) ALL
```
添加一行

```bash
sangjian    ALL=(ALL) NOPASSWD: ALL
```
上面的NOPASSWD表示，切换sudo的时候，不需要输入密码，我喜欢这样比较省事。如果出于安全考虑，也可以强制要求输入密码。
另开一个终端，以sangjian用户登录，检查是否设置成功

```bash
ssh sangjian@192.168.1.125
```

## 第三步：SSH设置

查看本机是否有SSH公钥（一般是~/.ssh/id_rsa.pub），如果没有则可以使用ssh-keygen命令生成
```bash
ssh-keygen
```
想省事的话可以一直按回车即可

将刚生成的id\_rsa.pub文件的内容追加到服务器的authorized_keys文件中
可以使用scp命令将生成的id\_rsa.pub文件上传到服务器中，再将文件的内容追加到authorized\_keys文件中
```bash
scp ~/.ssh/id_rsa.pub sangjian@192.168.1.125:/home/sangjian/mac_id_rsa.pub
```

上面的命令是将本地的公钥上传到服务器中的/home/sangjian目录下的mac\_id\_rsa.pub文件中

再执行追加命令（如果~/.ssh目录不存在，则新建）
```bash
cat mac_id_rsa.pub > ~/.ssh/authorized_keys
```

修改SSH配置文件/etc/ssh/sshd_config
在配置文件中找到 `#Port 22`，修改默认的端口，范围可以从1025到65536
```bash
Port 6983
```

修改如下设置并确保去除了#号
```bash
Protocol 2
#禁止root用户登录
PermitRootLogin no

#禁止使用密码登录
PasswordAuthentication no
PermitEmptyPasswords no
PasswordAuthentication yes
```
最后，在配置文件的末尾添加一行用来指定可以登录的用户
```bash
AllowUsers sangjian
```
保存退出后，修改authorized_keys和.ssh的文件权限
```bash
sudo chmod 700 ~/.ssh/
sudo chmod 600 ~/.ssh/authorized_keys
```
确保.ssh的权限为700，authorized_keys的权限为600，否则登录的时候会出现如下错误


{% asset_img -----2016-08-22---10-54-52.png %}

查看日志
```bash
sudo tail -n 20 /var/log/secure
```
可以看到登录时的日志有如下一句

```bash
localhost sshd[2359]: Authentication refused: bad ownership or modes for file /home/sangjian/.ssh/authorized_keys
```

{% asset_img -----2016-08-22---10-58-33.png %}
重启SSHD
```bash
sudo service sshd restart
```

检查是否可以免密码登录
```bash
ssh sangjian@192.168.1.125 -p 6983
```
发现不可以，提示
```bash
ssh: connect to host 192.168.1.125 port 6983: Connection refused
```

## 第四步：登录失败问题解决
出现这一情况主要是防火墙端口开放的问题
查看日志
```bash
sudo tail -n 20 /var/log/secure
```
发现没有失败的日志输出
查看防火墙是否开启
```bash
systemctl status firewalld
```
如果开启了，则原因就是刚刚设置的ssh端口6983并没有添加到防火墙中
添加端口到防火墙
```bash
sudo firewall-cmd --zone=public --permanent --add-port=6983/tcp
```
重启防火墙
```bash
sudo systemctl restart firewalld
```
查看端口是否添加成功

执行`sudo firewall-cmd --list-all`，如果出现以下输出，则证明添加成功

{% asset_img -----2016-08-22---11-18-34.png %}

## 第五步 登录服务器
SSH的配置已经完成了，下面测试以下是否可以登录

输入`ssh sangjian@192.168.1.125 -p 6983`，提示

{% asset_img -----2016-08-22---11-20-02.png %}

表示已经登录成功了，至此基于Centos7的服务器初步配置已经完成了。

本文主要介绍了SSH配置，剩下的可以根据需要配置一些安全相关的设置，比如防火墙的设置，端口的限制等等。

