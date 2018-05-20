---
title: AIO写文件的OutOfMemoryError
date: 2018-01-30 22:18:42
categories: 开发手册
tags: 
- Java
- AIO
---

## 问题重现

AIO进行写文件使用了AsynchronousFileChannel类来实现，测试代码如下：

```java
public class AsynchronousFileChannelTest {
    private static final String outputPath = "output.txt";
    private static String data = "你好";

    public static void main(String[] args) throws IOException {
        Path path = Paths.get(outputPath);
        if (!Files.exists(path)) {
            Files.createFile(path);
        }
        AsynchronousFileChannel fileChannel =
                AsynchronousFileChannel.open(path, StandardOpenOption.WRITE);

        ByteBuffer buffer = ByteBuffer.allocate(1024);
        long position = 0;

        buffer.put(data.getBytes());
        buffer.flip();

        for (int i = 0; i < 10000000; i++) {
            fileChannel.write(buffer, position, buffer, new CompletionHandler<Integer, ByteBuffer>() {

                @Override
                public void completed(Integer result, ByteBuffer attachment) {
                    System.out.println("bytes written: " + result);
                }

                @Override
                public void failed(Throwable exc, ByteBuffer attachment) {
                    System.out.println("Write failed");
                    exc.printStackTrace();
                }
            });
            position += data.getBytes().length;
        }

    }
}
```

<!-- more -->

执行结果如下：

```
java.lang.OutOfMemoryError: unable to create new native thread
	at java.lang.Thread.start0(Native Method)
	at java.lang.Thread.start(Thread.java:714)
	at java.util.concurrent.ThreadPoolExecutor.addWorker(ThreadPoolExecutor.java:950)
	at java.util.concurrent.ThreadPoolExecutor.execute(ThreadPoolExecutor.java:1368)
	at sun.nio.ch.Invoker.invokeIndirectly(Invoker.java:236)
	at sun.nio.ch.SimpleAsynchronousFileChannelImpl.implWrite(SimpleAsynchronousFileChannelImpl.java:359)
	at sun.nio.ch.AsynchronousFileChannelImpl.write(AsynchronousFileChannelImpl.java:251)
	at cn.ideabuffer.interview.test.io.AsynchronousFileChannelTest.main(AsynchronousFileChannelTest.java:34)
	at sun.reflect.NativeMethodAccessorImpl.invoke0(Native Method)
	at sun.reflect.NativeMethodAccessorImpl.invoke(NativeMethodAccessorImpl.java:62)
	at sun.reflect.DelegatingMethodAccessorImpl.invoke(DelegatingMethodAccessorImpl.java:43)
	at java.lang.reflect.Method.invoke(Method.java:497)
	at com.intellij.rt.execution.application.AppMain.main(AppMain.java:147)
```

可见，该问题是内存溢出，不能创建新的线程。

## 查看原因

那么，为什么会创建这么多的线程呢？

我们先来看一下AsynchronousFileChannelImpl类的write方法：

```java
public final <A> void write(ByteBuffer var1, long var2, A var4, CompletionHandler<Integer, ? super A> var5) {
    if(var5 == null) {
        throw new NullPointerException("\'handler\' is null");
    } else {
        this.implWrite(var1, var2, var4, var5);
    }
}
```

这里调用了implWrite方法，implWrite方法是在SimpleAsynchronousFileChannelImpl类中定义的，下面来看一下SimpleAsynchronousFileChannelImpl类的implWrite方法：**注意：因为我是在Mac OS上进行测试，windows下是没有SimpleAsynchronousFileChannelImpl类的**

```java
<A> Future<Integer> implWrite(final ByteBuffer var1, final long var2, final A var4, final CompletionHandler<Integer, ? super A> var5) {
    if(var2 < 0L) {
        throw new IllegalArgumentException("Negative position");
    } else if(!this.writing) {
        throw new NonWritableChannelException();
    } else if(this.isOpen() && var1.remaining() != 0) {
        final PendingFuture var8 = var5 == null?new PendingFuture(this):null;
        Runnable var7 = new Runnable() {
            public void run() {
                // 省略一些代码
                ...

            }
        };
        this.executor.execute(var7);
        return var8;
    } else {
        ClosedChannelException var6 = this.isOpen()?null:new ClosedChannelException();
        if(var5 == null) {
            return CompletedFuture.withResult(Integer.valueOf(0), var6);
        } else {
            Invoker.invokeIndirectly(var5, var4, Integer.valueOf(0), var6, this.executor);
            return null;
        }
    }
}
```

看一下第15行和第22行，这里都使用了executor来执行具体的写操作，而executor是在哪里定义的呢？

由于创建AsynchronousFileChannel对象的时候是如下代码：

```java
AsynchronousFileChannel fileChannel =
                AsynchronousFileChannel.open(path, StandardOpenOption.WRITE);
```

AsynchronousFileChannel的open方法定义如下：

```java
public static AsynchronousFileChannel open(Path file, OpenOption... options)
        throws IOException
{
    Set<OpenOption> set = new HashSet<OpenOption>(options.length);
    Collections.addAll(set, options);
    return open(file, set, null, NO_ATTRIBUTES);
}
```

这里调用了重载的open方法，注意第三个参数为null，该参数的类型就是ExecutorService，查看该方法：

```java
public static AsynchronousFileChannel open(Path file,
                                               Set<? extends OpenOption> options,
                                               ExecutorService executor,
                                               FileAttribute<?>... attrs)
        throws IOException
{
    FileSystemProvider provider = file.getFileSystem().provider();
    return provider.newAsynchronousFileChannel(file, options, executor, attrs);
}
```

这里的provider是UnixFileSystemProvider，查看该类的newAsynchronousFileChannel方法：

```java
public AsynchronousFileChannel newAsynchronousFileChannel(Path var1, Set<? extends OpenOption> var2, ExecutorService var3, FileAttribute... var4) throws IOException {
    UnixPath var5 = this.checkPath(var1);
    int var6 = UnixFileModeAttribute.toUnixMode(438, var4);
    ThreadPool var7 = var3 == null?null:ThreadPool.wrap(var3, 0);

    try {
        return UnixChannelFactory.newAsynchronousFileChannel(var5, var2, var6, var7);
    } catch (UnixException var9) {
        var9.rethrowAsIOException(var5);
        return null;
    }
}
```

调用了UnixChannelFactory的newAsynchronousFileChannel方法，该方法代码如下：

```java
static AsynchronousFileChannel newAsynchronousFileChannel(UnixPath var0, Set<? extends OpenOption> var1, int var2, ThreadPool var3) throws UnixException {
    UnixChannelFactory.Flags var4 = UnixChannelFactory.Flags.toFlags(var1);
    if(!var4.read && !var4.write) {
        var4.read = true;
    }

    if(var4.append) {
        throw new UnsupportedOperationException("APPEND not allowed");
    } else {
        FileDescriptor var5 = open(-1, var0, (String)null, var4, var2);
        return SimpleAsynchronousFileChannelImpl.open(var5, var4.read, var4.write, var3);
    }
}
```

这里就用到了SimpleAsynchronousFileChannelImpl的open方法：

```java
public static AsynchronousFileChannel open(FileDescriptor var0, boolean var1, boolean var2, ThreadPool var3) {
    ExecutorService var4 = var3 == null?SimpleAsynchronousFileChannelImpl.DefaultExecutorHolder.defaultExecutor:var3.executor();
    return new SimpleAsynchronousFileChannelImpl(var0, var1, var2, var4);
}
```

可以看到，这里的ExecutorService对象使用了DefaultExecutorHolder中的defaultExecutor：

```java
private static class DefaultExecutorHolder {
    static final ExecutorService defaultExecutor = ThreadPool.createDefault().executor();

    private DefaultExecutorHolder() {
    }
}
```

再看一下ThreadPool的createDefault方法：

```java
static ThreadPool createDefault() {
    int var0 = getDefaultThreadPoolInitialSize();
    if(var0 < 0) {
        var0 = Runtime.getRuntime().availableProcessors();
    }

    ThreadFactory var1 = getDefaultThreadPoolThreadFactory();
    if(var1 == null) {
        var1 = defaultThreadFactory();
    }

    // 创建executor
    ExecutorService var2 = Executors.newCachedThreadPool(var1);
    return new ThreadPool(var2, false, var0);
}
```

可以看到，这里默认创建了一个`CachedThreadPool`，在newCachedThreadPool方法中使用了SynchronousQueue作为任务队列：

```java
public static ExecutorService newCachedThreadPool(ThreadFactory threadFactory) {
    return new ThreadPoolExecutor(0, Integer.MAX_VALUE,
                                  60L, TimeUnit.SECONDS,
                                  new SynchronousQueue<Runnable>(),
                                  threadFactory);
}
```

这里注意第二个参数，第二个参数是设置线程池最大的任务数量，有关线程池请参考之前的文章[深入理解Java线程池：ThreadPoolExecutor](http://www.ideabuffer.cn/2017/04/04/%E6%B7%B1%E5%85%A5%E7%90%86%E8%A7%A3Java%E7%BA%BF%E7%A8%8B%E6%B1%A0%EF%BC%9AThreadPoolExecutor/)

也就是说，这里的任务数量是没有限制的，而SynchronousQueue这个队列比较特殊，它是一个没有数据缓冲的BlockingQueue(队列只能存储一个元素)，生产者线程对其的插入操作put必须等待消费者的移除操作take，反过来也一样，消费者移除数据操作必须等待生产者的插入。

不像ArrayBlockingQueue或LinkedListBlockingQueue，SynchronousQueue内部并没有数据缓存空间，你不能调用peek()方法来看队列中是否有数据元素，因为数据元素只有当你试着取走的时候才可能存在，不取走而只想偷窥一下是不行的，当然遍历这个队列的操作也是不允许的。队列头元素是第一个排队要插入数据的线程，而不是要交换的数据。数据是在配对的生产者和消费者线程之间直接传递的，并不会将数据缓冲数据到队列中。可以这样来理解：生产者和消费者互相等待对方，握手，然后一起离开。

根据我们的测试代码来看，写文件的时候会向executor中添加一个线程作为任务来执行，而这时如果磁盘的写速度太慢，而程序在不停地进行写任务的添加，这会导致队列中的对象越来越多，而队列中的对象就是Runnable对象，也就是线程对象。可以在报错信息中看到，异常是在Invoker类中：

```java
static <V, A> void invokeIndirectly(final CompletionHandler<V, ? super A> var0, final A var1, final V var2, final Throwable var3, Executor var4) {
    try {
        var4.execute(new Runnable() {
            public void run() {
                Invoker.invokeUnchecked(var0, var1, var2, var3);
            }
        });
    } catch (RejectedExecutionException var6) {
        throw new ShutdownChannelGroupException();
    }
}
```

这里执行的时候会创建一个线程对象，在调用了execute方法之后，会调用线程池中的addWorker方法添加任务：

```java
private boolean addWorker(Runnable firstTask, boolean core) {
    
    ...
    
    boolean workerStarted = false;
    boolean workerAdded = false;
    Worker w = null;
    try {
        w = new Worker(firstTask);
        final Thread t = w.thread;
        if (t != null) {
            final ReentrantLock mainLock = this.mainLock;
            mainLock.lock();
            try {
                ...            
            } finally {
                mainLock.unlock();
            }
            if (workerAdded) {
                t.start();
                workerStarted = true;
            }
        }
    } finally {
        if (! workerStarted)
            addWorkerFailed(w);
    }
    return workerStarted;
}
```

在添加任务完成后，会调用start方法来启动线程。

所以，在磁盘写速度比较慢的时候，不停地向线程池中添加线程对象并启动线程，而且队列的大小没有限制。

但这个异常并不是堆内存的溢出，堆内存的溢出如下：

```
Exception in thread "main" java.lang.OutOfMemoryError: Java heap space
```

## 问题分析

那么，究竟为什么会报不能创建线程的异常呢？

我们先把内存按区域进行以下分类：

* MaxProcessMemory：指的是一个进程的最大内存
* JVMMemory：JVM内存
* ReservedOsMemory：保留的操作系统内存
* ThreadStackSize：线程栈的大小

在java语言里， 当你创建一个线程的时候，虚拟机会在JVM内存创建一个Thread对象同时创建一个操作系统线程，而这个系统线程的内存用的不是JVMMemory，而是系统中剩下的内存(MaxProcessMemory - JVMMemory - ReservedOsMemory)。 

具体计算公式如下： 

```
(MaxProcessMemory - JVMMemory - ReservedOsMemory) / (ThreadStackSize) = Number of threads 
```

我们测一下如下代码：

```java
public class TestNativeOutOfMemoryError {

    public static void main(String[] args) {

        for (int i = 0;; i++) {
            System.out.println("i = " + i);
            new Thread(new HoldThread()).start();
        }
    }

}

class HoldThread extends Thread {
    CountDownLatch cdl = new CountDownLatch(1);

    public HoldThread() {
        this.setDaemon(true);
    }

    public void run() {
        try {
            cdl.await();
        } catch (InterruptedException e) {
        }
    }
}

```

该代码不停地创建线程，看下结果：

```
i = 4072
Exception in thread "main" java.lang.OutOfMemoryError: unable to create new native thread
```

最终停在了4072，也就是创建了4073个线程后报OOM。

查看一下系统的线程数量限制：

```bash
sangjiandeMBP:~ sangjian$ sysctl kern.num_taskthreads
kern.num_taskthreads: 4096
```

可见，系统的线程数量限制为4096，从这个数量来说，和我们运行的结果是一致的。

所以，第一个异常`Exception in thread "main" java.lang.OutOfMemoryError: unable to create new native thread`并不一定代表是系统内存不足导致的溢出，也可能是创建的线程数量达到了系统的限制。

## 解决问题

1. 如果程序中有bug，导致创建大量不需要的线程或者线程没有及时回收，那么必须解决这个bug，修改参数是不能解决问题的;
2. 如果程序确实需要大量的线程，现有的设置不能达到要求，那么可以通过修改MaxProcessMemory，JVMMemory，ThreadStackSize这三个因素，来增加能创建的线程数：

    * MaxProcessMemory 使用64位操作系统
    * JVMMemory   减少JVMMemory的分配
    * ThreadStackSize  减小单个线程的栈大小