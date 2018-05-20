---
title: TCP的连接队列与backlog参数
date: 2018-02-22 16:42:54
categories: 开发手册
tags: 
- Linux
- Netty
- TCP
---

在Netty中经常会看到这样的代码：

```java
ServerBootstrap b = new ServerBootstrap();
b.group(bossGroup, workerGroup)
        .channel(NioServerSocketChannel.class)
        .option(ChannelOption.SO_BACKLOG, 1024)
        .childHandler(new ChildChannelHandler());
```

这里有一个`SO_BACKLOG`参数，本篇文章解释一下这个参数的具体用途。

<!-- more -->

## TCP的连接队列

我们看一下TCP三次握手的过程：

{% asset_img "tcp-sync-queue-and-accept-queue.jpg" %}

1. 当 client 通过 connect 向 server 发出 SYN 包时，client 会维护一个 socket 等待队列，而 server 会维护一个 SYN 队列；
2. 此时进入半链接的状态，如果 socket 等待队列满了，server 则会丢弃，而 client 也会由此返回 connection time out；只要是 client 没有收到 SYN+ACK，3s 之后，client 会再次发送，如果依然没有收到，9s 之后会继续发送；
3. 半连接 syn 队列的长度为 `max(64, /proc/sys/net/ipv4/tcp_max_syn_backlog)`  决定
4. 当 server 收到 client 的 SYN 包后，会返回 SYN, ACK 的包加以确认，client 的 TCP 协议栈会唤醒 socket 等待队列，发出 connect 调用；
5. client 返回 ACK 的包后，server 会进入一个新的叫 accept 的队列，该队列的长度为 `min(backlog, somaxconn)`，默认情况下，somaxconn 的值为 128，表示最多有 129 的 ESTAB 的连接等待 accept()，而 backlog 的值则由 `int listen(int sockfd, int backlog)` 中的第二个参数指定，listen 里面的 backlog 的含义请看这里。需要注意的是，一些 Linux 的发型版本可能存在对 somaxcon 错误 truncating 方式；
6. 当 accept 队列满了之后，即使 client 继续向 server 发送 ACK 的包，也会不被相应，此时，server 通过 `/proc/sys/net/ipv4/tcp_abort_on_overflow` 来决定如何返回，0 表示直接丢丢弃该 ACK，1 表示发送 RST 通知 client；相应的，client 则会分别返回 `read timeout` 或者 `connection reset by peer`。上面说的只是些理论，如果服务器不及时的调用 accept()，当 queue 满了之后，服务器并不会按照理论所述，不再对 SYN 进行应答，返回 ETIMEDOUT。根据[这篇](https://www.douban.com/note/178129553/)文档的描述，实际情况并非如此，服务器会随机的忽略收到的 SYN，建立起来的连接数可以无限的增加，只不过客户端会遇到延时以及超时的情况。

可以看到，整个 TCP stack 有如下的两个 queue：

1. 一个是 half open(syn queue) queue(max(tcp_max_syn_backlog, 64))，用来保存 SYN_SENT 以及 SYN_RECV 的信息，其大小通过`/proc/sys/net/ipv4/tcp_max_syn_backlog`指定，一般默认值是512，不过这个设置有效的前提是系统的syncookies功能被禁用。互联网常见的TCP SYN FLOOD恶意DOS攻击方式就是建立大量的半连接状态的请求，然后丢弃，导致syns queue不能保存其它正常的请求。。
2. 另外一个是 accept queue(min(somaxconn, backlog))，保存全连接状态的请求，其大小通过`/proc/sys/net/core/somaxconn`指定，在使用listen函数时，内核会根据传入的backlog参数与系统参数somaxconn，取二者的较小值。

## Netty中的backlog参数

查看`EpollServerChannelConfig`中的backlog参数：

```java
private volatile int backlog = NetUtil.SOMAXCONN;
```

使用了`NetUtil.SOMAXCONN`变量的值，在`NetUtil`中查看：

```java
SOMAXCONN = AccessController.doPrivileged(new PrivilegedAction<Integer>() {
    @Override
    public Integer run() {
        // Determine the default somaxconn (server socket backlog) value of the platform.
        // The known defaults:
        // - Windows NT Server 4.0+: 200
        // - Linux and Mac OS X: 128
        int somaxconn = PlatformDependent.isWindows() ? 200 : 128;
        File file = new File("/proc/sys/net/core/somaxconn");
        BufferedReader in = null;
        try {
            // file.exists() may throw a SecurityException if a SecurityManager is used, so execute it in the
            // try / catch block.
            // See https://github.com/netty/netty/issues/4936
            if (file.exists()) {
                in = new BufferedReader(new FileReader(file));
                somaxconn = Integer.parseInt(in.readLine());
                if (logger.isDebugEnabled()) {
                    logger.debug("{}: {}", file, somaxconn);
                }
            } else {
                // Try to get from sysctl
                Integer tmp = null;
                if (SystemPropertyUtil.getBoolean("io.netty.net.somaxconn.trySysctl", false)) {
                    tmp = sysctlGetInt("kern.ipc.somaxconn");
                    if (tmp == null) {
                        tmp = sysctlGetInt("kern.ipc.soacceptqueue");
                        if (tmp != null) {
                            somaxconn = tmp;
                        }
                    } else {
                        somaxconn = tmp;
                    }
                }

                if (tmp == null) {
                    logger.debug("Failed to get SOMAXCONN from sysctl and file {}. Default: {}", file,
                                 somaxconn);
                }
            }
        } catch (Exception e) {
            logger.debug("Failed to get SOMAXCONN from sysctl and file {}. Default: {}", file, somaxconn, e);
        } finally {
            if (in != null) {
                try {
                    in.close();
                } catch (Exception e) {
                    // Ignored.
                }
            }
        }
        return somaxconn;
    }
});
```

可以看到，在默认情况下somaxconn的值为：

* Windows NT Server 4.0+: 200
* Linux and Mac OS X: 128

这里也通过`/proc/sys/net/core/somaxconn`文件来获取somaxconn的值。

上文中说到，内核会根据传入的backlog参数与系统参数somaxconn，取二者的较小值，所以，如果想扩大accept queue的大小，必须要同时调整这两个参数。