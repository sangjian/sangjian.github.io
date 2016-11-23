---
title: Linux/Centos7设置nginx开机自启动
date: 2016-08-26 00:04:12
categories: 服务器
tags:
- CentOS
- Linux
- Shell
---
## 新增shell脚本 vi /etc/rc.d/init.d/nginx
```bash
#! /bin/bash
# chkconfig: 35 85 15  
# description: Nginx is an HTTP(S) server, HTTP(S) reverse
set -e
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
DESC="nginx daemon"  
NAME=nginx  
DAEMON=/usr/local/nginx/sbin/$NAME  
SCRIPTNAME=/etc/init.d/$NAME  
test -x $DAEMON || exit 0  
d_start(){  
   $DAEMON || echo -n " already running"
}
d_stop() {  
   $DAEMON -s quit || echo -n " not running"
}
d_reload() {  
   $DAEMON -s reload || echo -n " counld not reload"
}
case "$1" in  
  start)  
     echo -n "Starting $DESC:$NAME"
     d_start
     echo "."
  ;;
  stop)  
     echo -n "Stopping $DESC:$NAME"
     d_stop
     echo "."
  ;;
  reload)  
     echo -n "Reloading $DESC configuration..."
     d_reload
     echo "reloaded."
  ;;
  restart)  
     echo -n "Restarting $DESC: $NAME"
     d_stop
     sleep 2
     d_start
     echo "."
  ;;
  *)
     echo "Usage: $SCRIPTNAME {start|stop|restart|reload}" >&2
     exit 3
  ;;
esac  
exit 0  
```
<!-- more -->

## 设置可执行权限
```bash
chmod +x /etc/rc.d/init.d/nginx
```
## 添加系统服务
```bash
chkconfig --add nginx 
```
## 开机自启动
```bash
chkconfig --level 35 nginx on
```
--------
原文链接: http://my.oschina.net/tomener/blog/664469
