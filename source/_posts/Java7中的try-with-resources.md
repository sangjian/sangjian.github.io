---
title: Java7 中的try-with-resources
date: 2016-12-02 01:21:26
categories: 开发手册
tags: Java
---

今天调试了一下Tomcat关闭代码，在执行关闭时会调用`Catalina`对象的`stopServer`方法，代码如下：

```java
public void stopServer(String[] arguments) {

    if (arguments != null) {
        arguments(arguments);
    }

    Server s = getServer();
    if (s == null) {
        // Create and execute our Digester
        Digester digester = createStopDigester();
        File file = configFile();
        try (FileInputStream fis = new FileInputStream(file)) {
            InputSource is =
                new InputSource(file.toURI().toURL().toString());
            is.setByteStream(fis);
            digester.push(this);
            digester.parse(is);
        } catch (Exception e) {
            log.error("Catalina.stop: ", e);
            System.exit(1);
        }
    } else {
        // Server object already present. Must be running as a service
        try {
            s.stop();
        } catch (LifecycleException e) {
            log.error("Catalina.stop: ", e);
        }
        return;
    }

    // Stop the existing server
    s = getServer();
    if (s.getPort()>0) {
        /*
         * 注意这段代码，并没有对资源进行close
         */
        try (Socket socket = new Socket(s.getAddress(), s.getPort());
                OutputStream stream = socket.getOutputStream()) {
            String shutdown = s.getShutdown();
            for (int i = 0; i < shutdown.length(); i++) {
                stream.write(shutdown.charAt(i));
            }
            stream.flush();
        } catch (ConnectException ce) {
            log.error(sm.getString("catalina.stopServer.connectException",
                                   s.getAddress(),
                                   String.valueOf(s.getPort())));
            log.error("Catalina.stop: ", ce);
            System.exit(1);
        } catch (IOException e) {
            log.error("Catalina.stop: ", e);
            System.exit(1);
        }
    } else {
        log.error(sm.getString("catalina.stopServer"));
        System.exit(1);
    }
}
```

啥意思呢，就是在执行`stopServer`方法时通过`Socket`来发送一个`SHUTDOWN`字符串到指定Tomcat的Server监听端口（默认为8005），来告诉Tomcat要执行关闭操作。

接收这个字符串的代码在`StandardServer`的`await`方法中，代码如下：

<!-- more -->

```java
try {
    InputStream stream;
    long acceptStartTime = System.currentTimeMillis();
    try {
        // 接收socket
        socket = serverSocket.accept();
        // 设置超时时间为10妙
        socket.setSoTimeout(10 * 1000);  // Ten seconds
        // 获取输入流
        stream = socket.getInputStream();
    } catch (SocketTimeoutException ste) {
        // This should never happen but bug 56684 suggests that
        // it does.
        log.warn(sm.getString("standardServer.accept.timeout",
                Long.valueOf(System.currentTimeMillis() - acceptStartTime)), ste);
        continue;
    } catch (AccessControlException ace) {
        log.warn("StandardServer.accept security exception: "
                + ace.getMessage(), ace);
        continue;
    } catch (IOException e) {
        if (stopAwait) {
            // Wait was aborted with socket.close()
            break;
        }
        log.error("StandardServer.await: accept: ", e);
        break;
    }

    // Read a set of characters from the socket
    int expected = 1024; // Cut off to avoid DoS attack
    while (expected < shutdown.length()) {
        if (random == null)
            random = new Random();
        expected += (random.nextInt() % 1024);
    }
    while (expected > 0) {
        int ch = -1;
        try {
            // 接收字符
            ch = stream.read();
        } catch (IOException e) {
            log.warn("StandardServer.await: read: ", e);
            ch = -1;
        }
        if (ch < 32)  // Control character or EOF terminates loop
            break;
        command.append((char) ch);
        expected--;
    }
} finally {
    // Close the socket now that we are done with it
    try {
        if (socket != null) {
            socket.close();
        }
    } catch (IOException e) {
        // Ignore
    }
}
```

注意看下第41行的代码`ch = stream.read()`，这个用来接收一个字符。再看下第46行，说明已经接收完毕，通常应该`ch`应该是-1，然后break。

但在关闭时断点如果执行完`stream.flush()`后，`await`方法在接收最后一个字符的时候会一直等待，直到timeOut指定的时间，然后会报如下异常：

```java
警告: StandardServer.await: read: 
java.net.SocketTimeoutException: Read timed out
	at java.net.SocketInputStream.socketRead0(Native Method)
	at java.net.SocketInputStream.socketRead(SocketInputStream.java:116)
	at java.net.SocketInputStream.read(SocketInputStream.java:170)
	at java.net.SocketInputStream.read(SocketInputStream.java:141)
	at java.net.SocketInputStream.read(SocketInputStream.java:223)
	at org.apache.catalina.core.StandardServer.await(StandardServer.java:498)
	at org.apache.catalina.startup.Catalina.await(Catalina.java:739)
	at org.apache.catalina.startup.Catalina.start(Catalina.java:685)
	at sun.reflect.NativeMethodAccessorImpl.invoke0(Native Method)
	at sun.reflect.NativeMethodAccessorImpl.invoke(NativeMethodAccessorImpl.java:62)
	at sun.reflect.DelegatingMethodAccessorImpl.invoke(DelegatingMethodAccessorImpl.java:43)
	at java.lang.reflect.Method.invoke(Method.java:497)
	at org.apache.catalina.startup.Bootstrap.start(Bootstrap.java:355)
	at org.apache.catalina.startup.Bootstrap.main(Bootstrap.java:495)
```

这说明这个socket并未关闭，回过头来看`stopServer`中的代码，发现在`try-catch`中并未显式关闭`socket`和`stream`，如果断点再走一步的话，在`await`中的接收就变的正常了，说明在`try`语句块中执行完毕后自动关闭了`socket`和`stream`。

这种写法还真是第一次见，孤陋寡闻了。。。

其实，这是Java7中提供的一个新的异常处理机制，它能够很容易地关闭在try-catch语句块中使用的资源。

还有一个名字，叫做*try-with-resources*

## 旧的代码风格

在Java7以前，代码中使用的资源需要被明确地关闭，这个在写的时候就会有些繁琐，例如下面的代码：

```java
public static void main(String[] args) throws IOException {

    InputStream in = null;

    try {
        in = new FileInputStream("test.txt");
        while (true) {
            int c = in.read();
            if (c == -1) {
                break;
            }
            System.out.println((char) c);
        }
    } finally {
        if (in != null)
            in.close();
    }
}
```

可以看到，上面代码在执行`new FileInputStream("test.txt")`、`in.read()`和`in.close()`时都可能抛出异常。

那么到这里可以分析一下，如果在`try`语句块中抛出了异常，`finally`语句块仍然会执行，然而`finally`语句块在执行`in.close()`时也可能会抛出异常。

这时问题来了，如果`try`语句块中抛出了异常，`finally`语句块也抛出了异常，那么到底是哪个异常会在方法返回时向外传播？

其实在上面的代码中，如果都抛出异常，则在`finally`语句块中抛出的异常会向外传播，`try`语句块中的异常被抑制了。

## try-with-resources代码风格

在Java7之后，上面的代码还可以这么写：

```java
public static void main(String[] args) throws IOException {

    try (InputStream in = new FileInputStream("test.txt");) {

        while (true) {
            int c = in.read();
            if (c == -1) {
                break;
            }
            System.out.println((char) c);
        }
    }
}
```
上面代码只是把InputStream放到了`try`语句后面的小括号中来声明创建一个`FileInputStream`对象，在`try`语句块运行结束时会对`FileInputStream `对象自动进行关闭。

为什么会这样？

因为`FileInputStream`实现了`java.lang.AutoCloseable`接口，可以看下对应的类结构：

{% asset_img "屏幕快照 2016-12-01 下午11.56.07.png" %}

所有实现了`java.lang.AutoCloseable`接口的类都可以在`try-with-resources`结构中使用。

那么再考虑一下之前提到过的问题，如果这时对`FileInputStream`对象自动关闭（会调用close方法）时抛出了异常，并且`in.read()`也抛出了异常，那么在方法执行完毕时，`in.read()`抛出的异常会向外传播，`FileInputStream`对象关闭时抛出的异常将被抑制。这与之前旧的代码风格的异常抛出方式正好相反。

## try-with-resources使用多个资源

在`try-with-resources`中可以使用多个资源，而且多个资源都能被自动关闭，代码如下：

```java
public static void main(String[] args) throws IOException {

    try (
            FileInputStream in = new FileInputStream("test.txt");
            BufferedInputStream bfIn = new BufferedInputStream((in));
    ) {

        while (true) {
            int c = bfIn.read();
            if (c == -1) {
                break;
            }
            System.out.println((char) c);
        }
    }
}
```
这里创建了两个资源：`FileInputStream`和`BufferedInputStream`。当`try`语句块运行结束时，这两个资源都会被自动关闭，而且关闭的顺序与创建的顺序相反（先关闭`BufferedInputStream`，后关闭`FileInputStream`），稍后会验证。

## AutoCloseable接口

先来查看一下`java.lang.AutoCloseable`接口的定义：

```java
public interface AutoCloseable {

    void close() throws Exception;

}
```

可以看到，只有一个`close()`方法。

## AutoCloseable接口的实现

下面自定义一个类，来实现这个接口：

```java
class AutoCloseableTest implements AutoCloseable {

    public void say() {
        System.out.println("Hello World");
    }

    @Override
    public void close() throws Exception {
        System.out.println("I'm closing...");
    }
}
```

该类实现了`AutoCloseable`接口，下面来使用这个类：

```java
public static void main(String[] args) throws Exception {
    try (
            AutoCloseableTest test = new AutoCloseableTest();
    ) {
        test.say();
    }
}
```

运行查看结果：

```
Hello World
I'm closing...
```

## 验证多个资源的关闭

代码如下：

```java
public class Test {

    public static void main(String[] args) throws Exception {
        try (
                AutoCloseableTest test = new AutoCloseableTest();
                AutoCloseableTest2 test2 = new AutoCloseableTest2();
        ) {
            test.say();
            test2.say();
        }
    }
}

class AutoCloseableTest implements AutoCloseable {

    public void say() {
        System.out.println("I'm in AutoCloseableTest");
    }

    @Override
    public void close() throws Exception {
        System.out.println("AutoCloseableTest is closing...");
    }
}

class AutoCloseableTest2 implements AutoCloseable {

    public void say() {
        System.out.println("I'm in AutoCloseableTest2");
    }

    @Override
    public void close() throws Exception {
        System.out.println("AutoCloseableTest2 is closing...");
    }
}
```

运行后的输出结果如下：

```
I'm in AutoCloseableTest
I'm in AutoCloseableTest2
AutoCloseableTest2 is closing...
AutoCloseableTest is closing...
```
可以看到，两个资源都被自动关闭了，而且顺序与创建的顺序相反。

## 验证被抑制的异常

```java
public class Test {

    public static void main(String[] args) {

        try {
            call();
        } catch (Exception e) {
            e.printStackTrace();
        }

    }

    private static void call() throws Exception {

        try (
                AutoCloseableTest test = new AutoCloseableTest();
        ) {
            test.say();
        } finally {
            System.out.println("I'm in finally");
        }
    }
}

class AutoCloseableTest implements AutoCloseable {

    public void say() throws MyException1 {
        throw new MyException1("I'm MyException1");
    }

    @Override
    public void close() throws MyException2 {
        throw new MyException2("I'm MyException2");
    }
}

class MyException1 extends Exception {
    public MyException1() {
        super();
    }

    public MyException1(String message) {
        super(message);
    }
}

class MyException2 extends Exception {
    public MyException2() {
        super();
    }

    public MyException2(String message) {
        super(message);
    }
}
```
上面代码定义了两个异常，在`main`方法中捕获并输出异常栈，结果如下：

```java
MyException1: I'm MyException1
	at AutoCloseableTest.say(Test.java:31)
	at Test.call(Test.java:21)
	at Test.main(Test.java:9)
	at sun.reflect.NativeMethodAccessorImpl.invoke0(Native Method)
	at sun.reflect.NativeMethodAccessorImpl.invoke(NativeMethodAccessorImpl.java:62)
	at sun.reflect.DelegatingMethodAccessorImpl.invoke(DelegatingMethodAccessorImpl.java:43)
	at java.lang.reflect.Method.invoke(Method.java:497)
	at com.intellij.rt.execution.application.AppMain.main(AppMain.java:147)
	Suppressed: MyException2: I'm MyException2
		at AutoCloseableTest.close(Test.java:36)
		at Test.call(Test.java:22)
		... 6 more
I'm in finally
```

可见，`try-with-resources`中自动关闭时调用`close()`方法抛出的异常被抑制了，捕获到的是`say()`方法抛出的异常`MyException1`。

## 验证自动关闭和finally的执行顺序

从上面代码可以看出，先输出了异常的信息，然后才输出`I'm in finally`，可见，在`finally`语句块执行之前自动关闭就已经被执行了。

## 总结

从以上的分析可以看出，`try-with-resources`风格可以实现以下几种情况：

* 任何实现了AutoCloseable接口的类，在`try()`里声明该类实例的时候，在`try`语句块结束时，都会调用该实例的`close()`方法
* 调用`close`方法时抛出的异常会被`try`语句块中抛出的异常抑制
* 在`finally`语句块执行前，`try()`中声明实例的`close()`方法总被调用
* `try()`中声明实例的`close()`方法总会被调用，即使`try`语句块中出现了异常
* `try()`中声明实例的关闭顺序与创建顺序相反