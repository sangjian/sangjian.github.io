---
title: Netty4源码分析-ServerBootstrap
date: 2017-09-19 14:24:09
categories: 
- Netty源码
tags: 
- Netty
- Java
- NIO
- IO
---
ServerBootstrap与Bootstrap类似，只不过这个是用于服务端的启动。下面看下具体的使用：

```java
public class TimeServer {

    public void bind(int port) throws Exception {
        // 配置服务端的NIO线程组
        EventLoopGroup bossGroup = new NioEventLoopGroup();
        EventLoopGroup workerGroup = new NioEventLoopGroup();
        try {
            ServerBootstrap b = new ServerBootstrap();
            b.group(bossGroup, workerGroup)
                    .channel(NioServerSocketChannel.class)
                    .option(ChannelOption.SO_BACKLOG, 1024)
                    .childHandler(new ChildChannelHandler());
            // 绑定端口，同步等待成功
            ChannelFuture f = b.bind(port).sync();

            // 等待服务端监听端口关闭
            f.channel().closeFuture().sync();
        } finally {
            // 优雅退出，释放线程池资源
            bossGroup.shutdownGracefully();
            workerGroup.shutdownGracefully();
        }
    }

    private class ChildChannelHandler extends ChannelInitializer<SocketChannel> {
        @Override
        protected void initChannel(SocketChannel arg0) throws Exception {
            arg0.pipeline().addLast(new TimeServerHandler());
        }

    }

    /**
     * @param args
     * @throws Exception
     */
    public static void main(String[] args) throws Exception {
        int port = 8080;
        if (args != null && args.length > 0) {
            try {
                port = Integer.valueOf(args[0]);
            } catch (NumberFormatException e) {
                // 采用默认值
            }
        }
        new TimeServer().bind(port);
    }
}
```

<!-- more -->

与上篇文章介绍的Bootstrap不同，这里传入了两个EventLoopGroup，其中bossGroup用于接收请求，workerGroup用于处理IO事件。Netty是Reactor模式的实现，有关Reactor模式请参考[NIO技术概览](http://www.ideabuffer.cn/2017/08/13/NIO%E6%8A%80%E6%9C%AF%E6%A6%82%E8%A7%88/)。

这里传入的Channel类型是NioServerSocketChannel，与Bootstrap一样，在bind方法中会调用init方法，下面看下ServerBootstrap中init方法的实现：

```java
@Override
void init(Channel channel) throws Exception {
    final Map<ChannelOption<?>, Object> options = options0();
    synchronized (options) {
        setChannelOptions(channel, options, logger);
    }

    final Map<AttributeKey<?>, Object> attrs = attrs0();
    synchronized (attrs) {
        for (Entry<AttributeKey<?>, Object> e: attrs.entrySet()) {
            @SuppressWarnings("unchecked")
            AttributeKey<Object> key = (AttributeKey<Object>) e.getKey();
            channel.attr(key).set(e.getValue());
        }
    }

    ChannelPipeline p = channel.pipeline();

    final EventLoopGroup currentChildGroup = childGroup;
    final ChannelHandler currentChildHandler = childHandler;
    final Entry<ChannelOption<?>, Object>[] currentChildOptions;
    final Entry<AttributeKey<?>, Object>[] currentChildAttrs;
    synchronized (childOptions) {
        currentChildOptions = childOptions.entrySet().toArray(newOptionArray(childOptions.size()));
    }
    synchronized (childAttrs) {
        currentChildAttrs = childAttrs.entrySet().toArray(newAttrArray(childAttrs.size()));
    }

	// 向pipeLine中添加Handler
    p.addLast(new ChannelInitializer<Channel>() {
        @Override
        public void initChannel(final Channel ch) throws Exception {
            final ChannelPipeline pipeline = ch.pipeline();
            ChannelHandler handler = config.handler();
            if (handler != null) {
                pipeline.addLast(handler);
            }
			// 使用eventLoop来执行任务
            ch.eventLoop().execute(new Runnable() {
                @Override
                public void run() {
                    pipeline.addLast(new ServerBootstrapAcceptor(
                            ch, currentChildGroup, currentChildHandler, currentChildOptions, currentChildAttrs));
                }
            });
        }
    });
}
```

注意一下这段代码：

```java
pipeline.addLast(new ServerBootstrapAcceptor(
        ch, currentChildGroup, currentChildHandler, currentChildOptions, currentChildAttrs));
```

这段代码向pipeLine中添加了一个ServerBootstrapAcceptor对象，ServerBootstrapAcceptor对象也是一个Handler，看下ServerBootstrapAcceptor的定义：

```java
private static class ServerBootstrapAcceptor extends ChannelInboundHandlerAdapter {

    private final EventLoopGroup childGroup;
    private final ChannelHandler childHandler;
    private final Entry<ChannelOption<?>, Object>[] childOptions;
    private final Entry<AttributeKey<?>, Object>[] childAttrs;
    private final Runnable enableAutoReadTask;

    ServerBootstrapAcceptor(
            final Channel channel, EventLoopGroup childGroup, ChannelHandler childHandler,
            Entry<ChannelOption<?>, Object>[] childOptions, Entry<AttributeKey<?>, Object>[] childAttrs) {
        this.childGroup = childGroup;
        this.childHandler = childHandler;
        this.childOptions = childOptions;
        this.childAttrs = childAttrs;

        // Task which is scheduled to re-enable auto-read.
        // It's important to create this Runnable before we try to submit it as otherwise the URLClassLoader may
        // not be able to load the class because of the file limit it already reached.
        //
        // See https://github.com/netty/netty/issues/1328
        enableAutoReadTask = new Runnable() {
            @Override
            public void run() {
                channel.config().setAutoRead(true);
            }
        };
    }

    @Override
    @SuppressWarnings("unchecked")
    public void channelRead(ChannelHandlerContext ctx, Object msg) {
        final Channel child = (Channel) msg;

        child.pipeline().addLast(childHandler);

        setChannelOptions(child, childOptions, logger);

        for (Entry<AttributeKey<?>, Object> e: childAttrs) {
            child.attr((AttributeKey<Object>) e.getKey()).set(e.getValue());
        }

        try {
            childGroup.register(child).addListener(new ChannelFutureListener() {
                @Override
                public void operationComplete(ChannelFuture future) throws Exception {
                    if (!future.isSuccess()) {
                        forceClose(child, future.cause());
                    }
                }
            });
        } catch (Throwable t) {
            forceClose(child, t);
        }
    }

    private static void forceClose(Channel child, Throwable t) {
        child.unsafe().closeForcibly();
        logger.warn("Failed to register an accepted channel: {}", child, t);
    }

    @Override
    public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) throws Exception {
        final ChannelConfig config = ctx.channel().config();
        if (config.isAutoRead()) {
            // stop accept new connections for 1 second to allow the channel to recover
            // See https://github.com/netty/netty/issues/1328
            config.setAutoRead(false);
            ctx.channel().eventLoop().schedule(enableAutoReadTask, 1, TimeUnit.SECONDS);
        }
        // still let the exceptionCaught event flow through the pipeline to give the user
        // a chance to do something with it
        ctx.fireExceptionCaught(cause);
    }
}
```

ServerBootstrapAcceptor继承自ChannelInboundHandlerAdapter，用于处理Inbound事件，该类的主要功能就是在服务器端接收到请求之后，会返回一个NioSocketChannel对象作为参数msg传入channelRead方法中，用变量child来表示；然后把在TimeServer中传入的childHandler添加到child所对应的pipeLine中，然后把child注册到childGroup中，也就是TimeServer中定义的workerGroup。

接收请求的操作是在NioServerSocketChannel中的doReadMessages方法中实现的：

```java
@Override
protected int doReadMessages(List<Object> buf) throws Exception {
    SocketChannel ch = SocketUtils.accept(javaChannel());

    try {
        if (ch != null) {
            buf.add(new NioSocketChannel(this, ch));
            return 1;
        }
    } catch (Throwable t) {
        logger.warn("Failed to create a new channel from an accepted socket.", t);

        try {
            ch.close();
        } catch (Throwable t2) {
            logger.warn("Failed to close a socket.", t2);
        }
    }

    return 0;
}
```

doReadMessages方法在NioMessageUnsafe中的read方法中调用，然后会执行`pipeline.fireChannelRead(readBuf.get(i));`将SocketChannel对象传入，也就是channelRead方法中的msg参数。至此，一个请求已经接收完毕，通道之间的通信就会交给childGroup，也就是TimeServer中的workerGroup来处理。
