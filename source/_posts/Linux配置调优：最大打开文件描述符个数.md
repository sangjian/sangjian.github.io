---
title: Linux配置调优：最大打开文件描述符个数
date: 2016-11-20 01:26:38
tags:
- Linux
categories:
- 服务器
---

一般情况下，Linux默认的最大文件描述符数量是1024，对于一般的程序来说1024应该是足够使用的（Nginx、系统进程等）。但是像mysql、java等单进程处理大量请求的应用来说就未必了。如果单个进程打开的文件描述符数量超过了系统定义的值，就会提到“too many files open”的错误提示。

如果想查看当前进程打开了多少个文件，可以执行如下命令查看：

`lsof -n | awk '{print $2}' | sort | uniq -c | sort -nr | more`

执行后可以看到，第一列是打开的文件描述符数量，第二列是进程id。

## 限制级别

最大文件描述符数的限制可以分为3种：

* shell级别的限制
* 用户级别的限制
* 系统级别的限制

<!-- more -->

### shell级别的限制
如果在shell中执行`ulimit -n 4096`后，表示将当前用户所有进程能打开的最大文件数量设置为4096.但只是在当前shell中有效，退出后再登录则又恢复成之前的限制。

### 用户级别的限制

用户级别的限制是针对具体的用户，一个用户可以通过多个shell打开，这里不针对每一个shell限制。

### 系统级别的限制

这一级别的限制是对整个系统的所有用户的限制，可以执行`cat /proc/sys/fs/file-max`来查看。

## ulimit命令

### ulimit功能介绍

考虑一下如下情况：

一台Linux主机上同时通过ssh登录了20个人，如果在系统资源无限制的情况下，这20个人同时打开了100个文档，并且每个文档的大小大概有20M，这时系统的内存资源就会力不从心了。

ulimit用于限制shell启动进程所占用的资源，支持以下各种类型的限制：所创建的内核文件的大小、进程数据块的大小、shell进程创建文件的大小、内存锁住的大小、常驻内存集的大小、打开文件描述符的数量、分配堆栈的最大大小、CPU时间、单个用户的最大线程数、shell进程所能使用的最大虚拟内存。同时，它支持对资源的硬限制和软限制。

ulimit可以作用于用户登录的当前shell会话，是一种临时限制。在会话终止时便结束限制，在shell中执行该命令不会影响其他shell会话。

如果想要使限制永久生效，则需要设置`/etc/security/limits.conf`文件，这个文件稍后会讲到。

### ulimit的使用说明

执行`help ulimit`命令可以查看一下该命令的使用说明：

{% asset_img "2016-11-20 1.18.23.png" %}

### ulimit限制最大打开文件描述符个数

由上可知，如果要限制最大打开文件描述符的个数可以执行以下命令：

`ulimit -n 1000`

该命令表示将最大打开文件描述符的个数限制为1000（只在当前shell中有效）。

这里需要注意的地方是，linux资源限制的方式可分为*软限制*和*硬限制*。

从`ulimit`的使用说明来看，`ulimit`的参数已经包含了软限制和硬限制，`-H`代表硬限制，`-S`代表软限制。

例如，执行`ulimit -Hn 1000`表示将硬限制设置为1000，同样`ulimit -Sn 1000`表示将软限制设置为1000，如果不指定`-H`或是`-S`，则相当于把软限制和硬限制都设置为1000。

它们之间的关系是：

* 软限制起实际限制作用，但不能超过硬限制（除非有root权限）。
* 普通用户可以在硬限制范围内，更改自己的软限制
* 普通用户都可以缩小硬限制,但不能扩大硬限制，而root缩小扩大都可以。

下面通过几个例子来说明`ulimit`命令的使用。

### `ulimit -n`的使用

如果你没有配置过，则默认的限制为1024
  
```
[root@localhost ~]# ulimit -n
1024
```
  
将限制设置为2048
  
```
[root@localhost ~]# ulimit -n 2048
```
  
查看软限制和硬限制

```
[root@localhost ~]# ulimit -Sn
2048
[root@localhost ~]# ulimit -Hn
2048
```
  
对于root用户，可以将增加硬限制
  
```
[root@localhost ~]# ulimit -n 2049
[root@localhost ~]#
```

对于普通用户，通过`ulimit -n`来查看

```
[sangjian@localhost ~]$ ulimit -n
1024
```

将限制改为1023，执行成功

```
[sangjian@localhost ~]$ ulimit -n 1023
[sangjian@localhost ~]$
```

将限制改为1025，执行失败

```
[sangjian@localhost ~]$ ulimit -n 1025
-bash: ulimit: open files: 无法修改 limit 值: 不允许的操作
```

可见，普通用户只能缩小限制，而不能扩大限制。

刚才说到执行`ulimit -n`是同时对软限制和硬限制都生效的，现在将软限制改为1000，执行成功

```
[sangjian@localhost ~]$ ulimit -Sn 1000
[sangjian@localhost ~]$
```

将软限制改为1024，执行失败，因为硬限制的值为1023

```
[sangjian@localhost ~]$ ulimit -Sn 1024
-bash: ulimit: open files: 无法修改 limit 值: 无效的参数
```



## 修改最大文件限制数量的方式

* 通过`ulimit -n`修改
* 通过`/etc/security/limits.conf`文件来修改
* 通过`/proc/sys/fs/file-max`文件来修改


## /etc/security/limits.conf
limits.conf文件实际是Linux PAM（插入式认证模块，Pluggable Authentication Modules）中 pam_limits.so 的配置文件，突破系统的默认限制，对系统访问资源有一定保护作用。 limits.conf 和sysctl.conf区别在于limits.conf是针对用户，而sysctl.conf是针对整个系统参数配置。

limits.conf的格式如下：

```
username|@groupname type resource limit
```
*username|@groupname*：设置需要被限制的用户名，组名前面加@和用户名区别。也可以用通配符*来做所有用户的限制。

*type*：有 soft，hard 和 -，soft 指的是当前系统生效的设置值。hard 表明系统中所能设定的最大值。soft 的限制不能比har 限制高。用 - 就表明同时设置了 soft 和 hard 的值。

*resource*：

```
　　core			- 限制内核文件的大小
　　date 			- 最大数据大小
　　fsize 		- 最大文件大小
　　memlock 		- 最大锁定内存地址空间
　　nofile 		- 打开文件的最大数目
　　rss 			- 最大持久设置大小
　　stack 		- 最大栈大小
　　cpu 			- 以分钟为单位的最多 CPU 时间
　　noproc 		- 进程的最大数目
　　as 			- 地址空间限制
　　maxlogins 	- 此用户允许登录的最大数目
　　maxsyslogins	- 系统所有登录的最大数量
　　
```

例如，如果想把最大文件描述符数设置为4096，且对所有用户生效，则在该文件中添加：

```
* soft nofile 4096
* hard nofile 4096
```


## /proc/sys/fs/file-max

该文件是系统级别的限制，可以查看该文件：

```
[root@localhost ~]# cat /proc/sys/fs/file-max
185983
```

可以看到，系统级别的最大文件描述符数是185983，该限制是对整个系统的所有用户生效。但是不是就不可以设置更大的限制数量呢？答案是否定的。对于root来说，可以设置大于这个数量的限制，例如：

```
[root@localhost ~]# ulimit -n 185984
[root@localhost ~]#
```

发现执行成功了，说明root是可以修改为更大的限制数量的。

其实，/proc/sys/fs/file-max是系统给出的建议值，系统会计算资源给出一个和合理值，一般跟内存有关系，内存越大，改值越大，但是仅仅是一个建议值，limits.conf的设定完全可以超过/proc/sys/fs/file-max。通过limits.conf文件来配置也是可以的。

## 需要注意的地方

### `ulimit -n`设置的是当前用户单个进程能够打开的文件描述符个数还是所有进程的文件描述符个数？

对于第一点，网上这两种说法都有，具体我也做了一些试验，例如，当用`vim`查看一个文件时，通过另一个shell登录后，查看vim进程的pid：

```
[sangjian@localhost ~]$ ps -ef | grep vim
sangjian  6099  6036  0 23:39 pts/0    00:00:00 vim test.sh
sangjian  6101  5986  0 23:39 pts/3    00:00:00 grep --color=auto vim
```

可知，pid是6099，查看`/proc/6099/fd`中的文件：

```
[sangjian@localhost ~]$ ll /proc/6099/fd
总用量 0
lrwx------. 1 sangjian sangjian 64 11月 19 23:41 0 -> /dev/pts/0
lrwx------. 1 sangjian sangjian 64 11月 19 23:41 1 -> /dev/pts/0
lrwx------. 1 sangjian sangjian 64 11月 19 23:39 2 -> /dev/pts/0
lrwx------. 1 sangjian sangjian 64 11月 19 23:41 4 -> /home/sangjian/.test.sh.swp
```

每个进程的信息都会在/proc目录中保存，fd目录为打开的文件描述符，可以看到当前打开了4个文件描述符。

修改`/etc/security/limits.conf`文件：

```
sangjian soft nofile 20
sangjian hard nofile 20
```

将`sangjian`这个用户的最大打开文件描述符个数设置为20，因为设置太小的话shell登录都不成功。然后新开了6个shell以`sangjian`这个用户来登录，并且每个都用`vim`打开一个文件，结果是都可以打开，这也就是说使用`ulimit -n`限制的是每个进程最大打开文件描述符的数量。

### `lsof -p pid`查看的结果是否都是该进程打开的文件描述符？

不都是。

`lsof`命令列出的是一个进程及其子进程与哪些文件有关联。

*请注意*：关联文件和打开文件描述符是不同的，关联文件的数量可能远远大于打开的文件描述符的数量。

比如刚刚查看的vim命令执行后，在`/proc`目录下查看了打开的文件描述符是4个，那么我们再通过`lsof`来看一下：

{% asset_img "2016-11-20 12.50.44.png" %}

可以看到，这个数量已经远远大于4了，这是为什么呢？

google找了一些资料，大概原因是`lsof`会列出系统中所占用的资源,但是这些资源不一定会占用打开的文件描述符(比如共享内存,信号量,消息队列,内存映射等，虽然占用了这些资源但不占用打开文件号)，因此有可能出现`cat /proc/sys/fs/file-max`的值小于`lsof | wc -l`。
