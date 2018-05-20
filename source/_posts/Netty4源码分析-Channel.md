---
title: Netty4源码分析-Channel
date: 2017-09-19 23:20:49
categories: 
- Netty源码
tags: 
- Netty
- Java
- NIO
- IO
---

## Channel的功能

基本的 I/O 操作(bind()、connect()、read()和 write())依赖于底层网络传输所提 供的原语。在基于 Java 的网络编程中，其基本的构造是 class Socket。Netty 的 Channel 接 口所提供的 API，大大地降低了直接使用 Socket 类的复杂性。此外，Channel 也是拥有许多 预定义的、专门化实现的广泛类层次结构的根，下面是一些Channel的类型:

* EmbeddedChannel
* LocalServerChannel
* NioDatagramChannel
* NioSctpChannel
* NioSocketChannel

io.netty.channel.Channel 是 Netty 网络操作抽象类，它聚合了一组功能，包括但不限于网络的读、写，客户端发起连接、主动关闭连接，链路关闭，获取通信双方的网络地址等。
它也包含了Netty框架相关的一些功能，包括获取该 Chanel的EventLoop，获取缓冲分配
器 ByteBufAllocator 和 pipeline 等。

<!-- more -->

## Channel的工作原理

Channel 是 Netty 抽象出来的网络I/O读写相关的接口，为什么不使用 JDK NIO 原生的 Channel 呢，主要原因如下：

1. JDK 的 SocketChannel 和 ServerSocketChannel 没有统一的 Channel 接口供业务幵
发者使用，对于用户而言，没有统一的操作视图，使用起来并不方便；
2. JDK 的 SocketChannel 和 ServerSocketChannel 的主要职责就是网络I/O操作，由
于它们是SPI类接口，由具体的虚拟机厂家来提供，所以通过继承SPI功能类来扩展其功
能的难度很大；直接实现 ServerSocketChannel 和 SocketChannel 抽象类，其工作量和重新
幵发一个新的 Channel 功能类是差不多的；
3. Netty 的 Channel 需要能够跟 Netty 的整体架构融合在一起，例如I/O模型、基于
 ChannelPipeline 的定制模型，以及基于元数据描述配置化的TCP参数等，这些 JDK 的
 SocketChannel 和 ServerSocketChannel 都没有提供，需要重新封装；
4. 自定义的Channel，功能实现更加灵活。

基于上述4个原因，Netty 重新设计了 Channel 接口，并且给予了很多不同的实现。
它的设计原理比较简单，但是功能却比较繁杂，主要的设计理念如下：

1. 	在Channel接口层，采用Facade模式进行统一封装，将网络I/O操作、网络I/O相关联的其他操作封装起来，统一对外提供；
2. Channel 接口的定义尽量大而全，为 SocketChannel 和 ServerSocketChannel 提供统一的视图，由不同子类实现不同的功能，公共功能在抽象父类中实现，最大程度上实现功能和接口的重用；
3. 具体实现采用聚合而非包含的方式，将相关的功能类聚合在 Channel 中，由 Channel 统一负责分配和调度，功能实现更加灵活。

## Channel的继承关系

下面是 Netty 中 Channel 的继承关系：

{% asset_img "channel-uml.png" %}

## AbstractChannel

我们看下AbstractChannel定义的变量：

```java
private final Channel parent;
private final ChannelId id;
private final Unsafe unsafe;
private final DefaultChannelPipeline pipeline;
private final VoidChannelPromise unsafeVoidPromise = new VoidChannelPromise(this, false);
private final CloseFuture closeFuture = new CloseFuture(this);

private volatile SocketAddress localAddress;
private volatile SocketAddress remoteAddress;
private volatile EventLoop eventLoop;
private volatile boolean registered;
private boolean closeInitiated;

/** Cache for the string representation of this channel */
private boolean strValActive;
private String strVal;
```

这里聚合了Channel、Unsafe、DefaultChannelPipeline和EventLoop，这里的parent变量对应ServerSocketChannel类型，每个Channel还需要一个Unsafe对象来进行实际的IO读写操作。

Netty对IO的处理要经过PipeLine来进行，而任务的执行是在EventLoop中进行的，所以，一个Channel对应一个PipeLine和一个EventLoop。

我们看下一些方法的实现：

```java
@Override
public ChannelFuture bind(SocketAddress localAddress) {
    return pipeline.bind(localAddress);
}

@Override
public ChannelFuture connect(SocketAddress remoteAddress) {
    return pipeline.connect(remoteAddress);
}

@Override
public ChannelFuture write(Object msg) {
    return pipeline.write(msg);
}

@Override
public Channel read() {
    pipeline.read();
    return this;
}

@Override
public ChannelFuture deregister() {
    return pipeline.deregister();
}
```

可见，所有的网络IO操作都交给了pipeLine，由添加到pipeLine中的ChannelHandler来执行具体的处理。

## AbstractNIOChannel

我们看下在AbstractNioChannel中定义的一些成员变量：

```java
private final SelectableChannel ch;
protected final int readInterestOp;
volatile SelectionKey selectionKey;
boolean readPending;

/**
 * The future of the current connection attempt.  If not null, subsequent
 * connection attempts will fail.
 */
private ChannelPromise connectPromise;
private ScheduledFuture<?> connectTimeoutFuture;
private SocketAddress requestedRemoteAddress;
```

这里聚合了一个SelectableChannel类型的变量ch，因为SocketChannel和ServerSocketChannel需要共用。

readInterestOp默认设置的值是SelectionKey的OP_READ。

定义了一个SelectionKey对象，保存该Channel注册到selector后的返回键。

最后定义了表示连接结果的ChannelPromise以及超时的定时器和需要请求的通信地址。

下面我们看下AbstractNIOChannel中执行注册的方法：

```java
@Override
protected void doRegister() throws Exception {
    boolean selected = false;
    for (;;) {
        try {
            selectionKey = javaChannel().register(eventLoop().unwrappedSelector(), 0, this);
            return;
        } catch (CancelledKeyException e) {
            if (!selected) {
                // Force the Selector to select now as the "canceled" SelectionKey may still be
                // cached and not removed because no Select.select(..) operation was called yet.
                eventLoop().selectNow();
                selected = true;
            } else {
                // We forced a select operation on the selector before but the SelectionKey is still cached
                // for whatever reason. JDK bug ?
                throw e;
            }
        }
    }
}
```

这里的死循环要确保注册成功，如果此通道当前已注册到给定的选择器，但相应的键已被取消，那么会抛出CancelledKeyException。

该方法定义了一个selected变量表示是否执行了select方法，如果发生了CancelledKeyException，那么执行`eventLoop().selectNow()`，因为如果`Select.select(..)`方法没有被调用时，被取消的SelectionKey可能还会缓存在selector中没有被删除。这时设置selected的值为true表示已经调用过`Select.select(..)`方法了。

如果这时selected变量为true，再次执行循环时又发生了CancelledKeyException，则说明执行了select方法后，SelectionKey还存在于selector中，这可能就触发了JDK中的BUG，直接抛出异常。

下面的doBeginRead方法在 Channel.read() 或者 ChannelHandlerContext.read() 调用的时候被调用，将readPending设置为true，同时将selectionKey增加可读的操作：

```java
@Override
protected void doBeginRead() throws Exception {
    // Channel.read() or ChannelHandlerContext.read() was called
    final SelectionKey selectionKey = this.selectionKey;
    if (!selectionKey.isValid()) {
        return;
    }

    readPending = true;

    final int interestOps = selectionKey.interestOps();
    if ((interestOps & readInterestOp) == 0) {
        selectionKey.interestOps(interestOps | readInterestOp);
    }
}
```

