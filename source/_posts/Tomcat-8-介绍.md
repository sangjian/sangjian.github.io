---
title: Tomcat 8 介绍
date: 2016-09-01 21:52:06
tags:
- Tomcat
---
## Apache Tomcat 版本介绍
Tomcat是一个开源的软件，其实现了Java Servlet, JavaServer Pages, Java Expression Language 以及 Java WebSocket 技术。Java Servlet, JavaServer Pages, Java Expression Language 以及 Java WebSocket 规范是在 [Java Community Process](http://www.jcp.org) 下开发出来的。

不同版本的Apache Tomcat实现了不同版本的Servlet和JSP规范。它们之间的对应关系如下：

{% asset_img "QQ20160901-0-2x.png" %}


当选举一个发布版本时，如果审阅者认为次发布版本已经达到稳定水平，则会选取此版本为稳定版。新的主要版本最初的发布通常从Alpha版本开始,然后经历beta版，最后到稳定版，这通常要经历几个月的时间。不过，稳定版的条件是Java规范的实现都已经完成。也就是说，在所有其他方面被认为是稳定的，但如果规范的实现不是最终的，可能仍然被标记为Beta版。


**Alpha**  由于规范的要求和/或一些显著的bug的原因，可能含有大量的未经测试或者缺少的功能，并且预计不会在任何时间内稳定地运行。

**Beta** 可能含有一些未经测试的功能和/或一些相对较小的错误。Beta版预计不会稳定地运行。

**Stable** 可能包含少量相对较小的错误。稳定版本可以用于进行生产环境使用，预计可以长时间稳定地运行。

参考：[Apache Tomcat Versions](http://tomcat.apache.org/whichversion.html)

## Tomcat 8.0.x 版本

Tomcat 8.0.x最新的版本是Tomcat 8.0.36。该系列同样实现了 Servlet 3.1, JSP 2.3, EL 3.0 and Web Socket 1.0 规范。该系列版本的新特性有：

+ 对资源进行了重构，合并了Aliases，VirtualLoader，VirtualDirContext，JAR资源和外部仓库，现在都以单个的、一致的方法进行配置。

+ 新增了当Tomcat未运行时对war包修改的检测。Tomcat会在解压后的目录中创建一个META-INF/war-tracker文件，设置该文件的最后修改时间为war包的最后修改时间。如果Tomcat通过这种机制检测到修改过的war包则会重新部署该web应用（也就是说之前的解压目录会被删除，修改过的war包会重新解压到当前目录）。

+ 新增了支持并行加载的web应用程序的类加载器`ParallelWebappClassLoader`的实现。

+ ~~实验支持SPDY[^1]~~。

+ 连接器默认使用无阻塞I/O。现在HTTP和AJP的连接器默认的都是无阻塞的I/O。

+ 修改了连接器的默认URIEncoding，将之前的ISO-8859-1修改为UTF-8。

参考：[Tomcat 8.0.x Changelog](http://tomcat.apache.org/tomcat-8.0-doc/changelog.html)

## Tomcat 8.5.x 版本
Tomcat 8.5.4于2016年7月12日发布，这个版本的分支来自Tomcat9.0.0.M4。主要的目的是恢复Java 7的兼容性，并支持Servlet3.1，JSP2.3，EL3.0，WebSocket1.1以及1.1 JASPIC规范。
> The Tomcat 8.5.x branch was created from the Tomcat 9.0.0.M4 tag. Changes were applied to restore Java 7 compatibility and to align the specification APIs with Servlet 3.1, JSP 2.3, EL 3.0, WebSocket 1.1 and JASPIC 1.1.[^2]

该系列版本的主要新特性有：

+ 新增了 `org.apache.catalina.servlet4preview` 包，作用是可以尽早地获取Servlet 4.0 的新特性（需要注意的是，这个包Tomcat 9.x将不会出现）。

+ 新增了对 JASPIC (JSR-196) 的支持。

+ 新增了对 HTTP/2 支持。

+ 新增了动态添加 TLS 虚拟主机的功能。

参考：[Tomcat 8.5.x Changelog](http://tomcat.apache.org/tomcat-8.5-doc/changelog.html)

----
[^n]: SPDY协议是Google提出的基于传输控制协议(TCP)的应用层协议，通过压缩、多路复用和优先级来缩短加载时间。该协议是一种更加快速的内容传输协议。该功能在 Tomcat 8.0.22 版本被删除
[^n]: http://tomcat.apache.org/tomcat-8.5-doc/changelog.html
