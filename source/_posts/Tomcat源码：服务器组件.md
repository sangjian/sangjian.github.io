---
title: Tomcat源码：服务器组件
date: 2016-12-03 22:48:55
categories:
- Tomcat源码 
tags:
- Tomcat
---

## Server接口

`org.apache.catalina.Server`接口定义了Tomcat的服务器组件，该接口的实例代表了整个servlet引擎，包括了所有的组件。Tomcat的服务器组件非常重要，因为它可以很优雅的来启动或关闭整个系统，不需要对连接器和容器单独进行启动和关闭。

下面来介绍一下启动和关闭的工作原理。

从之前的文章[Tomcat源码：Bootstrap启动流程](/2016/11/26/Tomcat源码：Bootstrap启动流程/)和[Tomcat源码：Catalina启动流程](/2016/11/27/Tomcat源码：Catalina启动流程/)可以了解到，当Tomcat启动的时候，会调用`Catalina`的`setAwait(true)`方法，将`await`变量设置为`true`，然后调用`start`方法启动Tomcat，看下`Catalina`中的`start`方法的最后几行：

```java
if (await) {
    await();
    stop();
}
```

<!-- more -->

回顾一下上篇[Tomcat源码：Catalina启动流程](/2016/11/27/Tomcat源码：Catalina启动流程/)中提到的`await`方法的作用：

* 判断当前启动的Server所要绑定的端口是否被占用
* 监听Server的端口，会一直等待接收关闭命令

如果要关闭Tomcat，就可以向Server指定的端口发送一个关闭命令（默认是*SHUTDOWN*），接收到关闭命令后就会关闭所有的组件。

下面给出Server接口的定义：

```java
public interface Server extends Lifecycle {

    public NamingResourcesImpl getGlobalNamingResources();

    public void setGlobalNamingResources(NamingResourcesImpl globalNamingResources);

    public javax.naming.Context getGlobalNamingContext();

    public int getPort();

    public void setPort(int port);

    public String getAddress();

    public void setAddress(String address);

    public String getShutdown();

    public void setShutdown(String shutdown);

    public ClassLoader getParentClassLoader();

    public void setParentClassLoader(ClassLoader parent);

    public Catalina getCatalina();

    public void setCatalina(Catalina catalina);

    public File getCatalinaBase();

    public void setCatalinaBase(File catalinaBase);

    public File getCatalinaHome();

    public void setCatalinaHome(File catalinaHome);

    public void addService(Service service);

    public void await();

    public Service findService(String name);

    public Service[] findServices();

    public void removeService(Service service);

    public Object getNamingToken();
}

```

可以看到，`setShutdown`方法用于设置Server的关闭命令，`setPort`方法用于设置Server的端口，用于接收关闭命令，`addService`方法用于添加服务组件，`removeService`方法用来删除服务组件，`findServices`方法用来添加到该服务器组件的所有服务组件，以及刚才提到的`await`方法。

## StandardServer类

`org.apache.catalina.core.StandardServer`类是`Server`接口的标准实现。从Server接口的定义可以看出，一个服务器组件可以有多个服务组件，当然，由于`StandardServer`继承了`LifecycleBase`，也就是实现了`LifeCycle`接口，所以StandardServer类中有4个与生命周期有关的方法，分别是`initInternal()`方法、`startInternal()`方法、`stopInternal()`和`destroyInternal()`方法。

说明一下，上面4个方法对应于`Lifecycle`接口中定义的`init()`方法、`start()`方法、`stop()`方法和`destroy()`方法，这4个方法已经被`LifecycleBase`实现，而`LifecycleBase`是一个抽象类，以`initInternal()`方法为例，该方法是一个抽象方法，StandardServer实现了该方法，相当于一个钩子方法，如果你了解了设计模式中的模板模式，这个应该就好理解了，看下`LifecycleBase`中的代码：

```java
@Override
public final synchronized void init() throws LifecycleException {
    if (!state.equals(LifecycleState.NEW)) {
        invalidTransition(Lifecycle.BEFORE_INIT_EVENT);
    }
    setStateInternal(LifecycleState.INITIALIZING, null, false);

    try {
        initInternal();
    } catch (Throwable t) {
        ExceptionUtils.handleThrowable(t);
        setStateInternal(LifecycleState.FAILED, null, false);
        throw new LifecycleException(
                sm.getString("lifecycleBase.initFail",toString()), t);
    }

    setStateInternal(LifecycleState.INITIALIZED, null, false);
}


protected abstract void initInternal() throws LifecycleException;

```

这下应该很明白了吧。类似的还有`start()`方法和`stop()`方法。

有关生命周期我以后会单独写一篇文章，这里就不过多介绍了。

看一下服务器组件的类图：

{% asset_img "屏幕快照 2016-12-04 上午12.34.30.png" %}

### initInternal方法

该方法代码如下：

```java
@Override
protected void initInternal() throws LifecycleException {

    super.initInternal();

    // Register global String cache
    // Note although the cache is global, if there are multiple Servers
    // present in the JVM (may happen when embedding) then the same cache
    // will be registered under multiple names
    onameStringCache = register(new StringCache(), "type=StringCache");

    // Register the MBeanFactory
    MBeanFactory factory = new MBeanFactory();
    factory.setContainer(this);
    onameMBeanFactory = register(factory, "type=MBeanFactory");

    // Register the naming resources
    globalNamingResources.init();

    // Populate the extension validator with JARs from common and shared
    // class loaders
    if (getCatalina() != null) {
        ClassLoader cl = getCatalina().getParentClassLoader();
        // Walk the class loader hierarchy. Stop at the system class loader.
        // This will add the shared (if present) and common class loaders
        while (cl != null && cl != ClassLoader.getSystemClassLoader()) {
            if (cl instanceof URLClassLoader) {
                URL[] urls = ((URLClassLoader) cl).getURLs();
                for (URL url : urls) {
                    if (url.getProtocol().equals("file")) {
                        try {
                            File f = new File (url.toURI());
                            if (f.isFile() &&
                                    f.getName().endsWith(".jar")) {
                                ExtensionValidator.addSystemResource(f);
                            }
                        } catch (URISyntaxException e) {
                            // Ignore
                        } catch (IOException e) {
                            // Ignore
                        }
                    }
                }
            }
            cl = cl.getParent();
        }
    }
    // Initialize our defined Services
    for (int i = 0; i < services.length; i++) {
        services[i].init();
    }
}
```

前面是JNDI和一些MBean的操作以及对扩展依赖项的验证，最后是初始化服务组件。

服务组件`services`怎么来的？回顾一下[Tomcat源码：Catalina启动流程](/2016/11/27/Tomcat源码：Catalina启动流程/#createStartDigester方法)中的`createStartDigester`方法，想想也就可以知道，肯定是通过解析`server.xml`文件得到的。

### startInternal方法

```java
@Override
protected void startInternal() throws LifecycleException {

    fireLifecycleEvent(CONFIGURE_START_EVENT, null);
    setState(LifecycleState.STARTING);

    globalNamingResources.start();

    // Start our defined Services
    synchronized (servicesLock) {
        for (int i = 0; i < services.length; i++) {
            services[i].start();
        }
    }
}
```

非常简单，首先是对全局JNDI的资源的启动，然后是对服务组件的启动。

介绍到这里，其实`stopInternal()`方法和`destroyInternal()`方法与这两种方法类似，无非就是调用服务组件的`stop()`方法和`destroy()`方法。

## 总结

从上面的分析可以看出，StandardServer作为一个标准的服务器组件，它的主要工作是对服务组件的初始化、启动、关闭和销毁，功能比较简单，同时也可以看出，它使用一种优雅的方式来对服务组件进行启动和关闭的操作，没有对连接器和容器进行单独操作。

服务器组件实现了`Lifecycle`接口，生命周期在整个Tomcat中具有非常重要的作用，可以用它来管理不同层级的组件，Tomcat在设计上允许一个组件包含其他组件，例如本文中介绍的服务器组件，它包含了服务组件，再例如，服务组件包含了连接器和容器，容器中又可以包含类加载器和管理器等等。

父组件可以启动或关闭子组件，正式这种设计使得Tomcat在启动时只需要启动一个组件就可以将全部的组件都启动起来，这就是单一启动/关闭机制，而实现这一机制就是通过实现`Lifecycle`接口来完成的。

不多说了，好像有点跑题了。。。但要弄清楚服务器组件的工作流程必然要提及到`Lifecycle`，通过本篇文章的介绍，相信大家已经对服务器组件的工作有了一定了解，后续会继续分析服务组件以及详细介绍一下生命周期，先到这里吧。

