---
title: Nginx配置：虚拟主机（1）
date: 2016-11-12 16:50:16
categories: 服务器
tags: Nginx
---
## 什么是虚拟主机
虚拟主机使用的是特殊的软硬件技术，它把一台运行在因特网上的服务器主机分成一台台“虚拟”的主机，每
台虚拟主机都可以是一个独立的网站，可以具有独立的域名，具有完整的Intemet服务器功能（WWW、FTP、Email等），同一台主机上的虚拟主机之间是完全独立的。从网站访问者来看，每一台虚拟主机和一台独立的主机完全一样。

利用虚拟主机，不用为每个要运行的网站提供一台单独的Nginx服务器或单独运行一组Nginx进程。虚拟主机提供了在同一台服务器、同一组Nginx进程上运行多个网站的功能。

在Nginx下，一个server标签就是一个虚拟主机，有一下3种：

* 基于域名的虚拟主机，通过域名来区分虚拟主机
* 基于端口的虚拟主机，通过端口来区分虚拟主机
* 基于IP的虚拟主机，通过IP地址来区分虚拟主机

<!-- more -->

## 基于域名的虚拟主机

该虚拟主机主要应用在外部网站，例如：

```nginx
server {
   listen 80;
   server_name www.abc.com;
   index index.html;
   ...
}
server {
   listen 80;
   server_name blog.abc.com;
   index index.html;
   ...
}
```

## 基于端口的虚拟主机

该虚拟主机主要应用在公司的内部网站或者网站的后台，例如：

```nginx
server {
    listen 8080;
    server_name www.abc.com;
    ...
}
server {
    listen 8011;
    server_name blog.abc.com;
    ...
}
```

## 基于IP的虚拟主机

配置该虚拟主机主要是用来通过IP进行访问，一般配置多个IP。配置基于IP的虚拟主机，就是为Nginx服务器提供的每台虚拟主机配置一个不同的IP，所以需要将网卡设置为同时能够监听多个IP地址。

Linux支持IP别名的添加，可以使用`ifconfig`命令来为同一块网卡添加多个IP别名。

例如，我当前的网络配置如下：

{% asset_img "2016-11-12 4.14.33.png" %}

可见，我当前的网卡为enp0s3，ip为192.168.1.125.

接下来需要为enp0s3添加两个IP别名：192.168.1.30和192.168.1.31，作为Nginx基于IP的虚拟主机的IP地址，命令如下：

```bash
sudo ifconfig enp0s3:0 192.168.1.30 netmask 255.255.255.0 up
sudo ifconfig enp0s3:1 192.168.1.31 netmask 255.255.255.0 up
```
命令中up表示立即启用该别名。

这时再次查看一下网络配置：

{% asset_img "2016-11-12 4.22.15.png" %}

可以看到，enp0s3增加了两个别名，enp0s3:0和enp0s3:1，IP分别为192.168.1.30,192.168.1.31。

*注意：*

* 如果你使用Centos7最小化安装会提示找不到`ifconfig`命令，这是需要安装net-tools:

  ```bash
  sudo yum -y install net-tools
  ```
  
*  按照如上方法为enp0s3设置的别名在重启后将会失效，需要重新设置。如果需要永久生效的话可以执行如下命令：
  
  ```bash
  sudo echo "ifconfig enp0s3:0 192.168.1.30 netmask 255.255.255.0 up" >> /etc/rc.local
  sudo echo "ifconfig enp0s3:1 192.168.1.31 netmask 255.255.255.0 up" >> /etc/rc.local
  ```

设置好别名之后就可以使用IP地址来配置Nginx的虚拟主机了：

```nginx
server {
    listen 80;
    server_name 192.168.1.30;
    ...
}
server {
    listen 80;
    server_name 192.168.1.31;
    ...

}
```
经过以上配置后，来自192.168.1.30的请求将由第一个虚拟主机接收和处理，来自192.168.1.31的请求将由第二个虚拟主机接收和处理。