---
title: Dubbo源码分析：Directory
date: 2018-05-13 00:08:31
categories: 
- 开发手册
- 分布式
tags: 
- 计算机
- 分布式
- Java
- Dubbo
---

## 介绍
在集群容错时，dubbo处理的流程如下图所示：

{% asset_img "cluster.jpg" %}

下面是来自官网的介绍，各节点关系如下：

* 这里的 `Invoker` 是 `Provider` 的一个可调用 `Service` 的抽象，`Invoker` 封装了 `Provider` 地址及 `Service` 接口信息
* `Directory` 代表多个 `Invoker`，可以把它看成 `List<Invoker>` ，但与 `List` 不同的是，它的值可能是动态变化的，比如注册中心推送变更
* `Cluster` 将 `Directory` 中的多个 `Invoker` 伪装成一个 `Invoker`，对上层透明，伪装过程包含了容错逻辑，调用失败后，重试另一个
* `Router` 负责从多个 `Invoker` 中按路由规则选出子集，比如读写分离，应用隔离等
* `LoadBalance` 负责从多个 `Invoker` 中选出具体的一个用于本次调用，选的过程包含了负载均衡算法，调用失败后，需要重选

本篇将介绍这里的 `Directory`。

<!-- more -->

## Directory的定义

看下 `Directory` 的类图：

{% asset_img "directory.png" %}

这里有两种 `Directory` ：`RegistryDirectory` 和 `StaticDirectory`。看名字就知道是什么意思了，第一种是通过注册中心获取，它的值可能是动态变化的；第二种是不会动态变化的，可以查看其构造方法：

```java
public StaticDirectory(URL url, List<Invoker<T>> invokers, List<Router> routers) {
    super(url == null && invokers != null && !invokers.isEmpty() ? invokers.get(0).getUrl() : url, routers);
    if (invokers == null || invokers.isEmpty())
        throw new IllegalArgumentException("invokers == null");
    this.invokers = invokers;
}
```

这里的 `invokers` 只在构造时被设置了一次。本文主要介绍的是 `RegistryDirectory`。

看下 `Directory` 接口的定义：

```java
public interface Directory<T> extends Node {

    /**
     * get service type.
     *
     * @return service type.
     */
    Class<T> getInterface();

    /**
     * list invokers.
     *
     * @return invokers
     */
    List<Invoker<T>> list(Invocation invocation) throws RpcException;

}
```

主要是 `list` 方法，该方法会列出所有的服务提供者。

## 代码分析

下面从官网给出的消费者的实例来进行分析：

```java
public class Consumer {

    public static void main(String[] args) {
        //Prevent to get IPV6 address,this way only work in debug mode
        //But you can pass use -Djava.net.preferIPv4Stack=true,then it work well whether in debug mode or not
        System.setProperty("java.net.preferIPv4Stack", "true");
        ClassPathXmlApplicationContext context = new ClassPathXmlApplicationContext(new String[]{"META-INF/spring/dubbo-demo-consumer.xml"});
        context.start();
        DemoService demoService = (DemoService) context.getBean("demoService"); // get remote service proxy

        while (true) {
            try {
                Thread.sleep(1000);
                String hello = demoService.sayHello("world"); // call remote method
                System.out.println(hello); // get result

            } catch (Throwable throwable) {
                throwable.printStackTrace();
            }


        }

    }
}
```

在调用 `sayHello` 方法时，会进入 `MockClusterInvoker` 中的 `invoke` 方法：

```java
@Override
public Result invoke(Invocation invocation) throws RpcException {
    Result result = null;

    String value = directory.getUrl().getMethodParameter(invocation.getMethodName(), Constants.MOCK_KEY, Boolean.FALSE.toString()).trim();
    if (value.length() == 0 || value.equalsIgnoreCase("false")) {
        //no mock
        result = this.invoker.invoke(invocation);
    } else if (value.startsWith("force")) {
        if (logger.isWarnEnabled()) {
            logger.info("force-mock: " + invocation.getMethodName() + " force-mock enabled , url : " + directory.getUrl());
        }
        //force:direct mock
        result = doMockInvoke(invocation, null);
    } else {
        //fail-mock
        try {
            result = this.invoker.invoke(invocation);
        } catch (RpcException e) {
            if (e.isBiz()) {
                throw e;
            } else {
                if (logger.isWarnEnabled()) {
                    logger.warn("fail-mock: " + invocation.getMethodName() + " fail-mock enabled , url : " + directory.getUrl(), e);
                }
                result = doMockInvoke(invocation, e);
            }
        }
    }
    return result;
}
```

 `MockClusterInvoker` 主要是进行本地伪装，这个在以后将 `Cluster` 的时候再详细介绍。
 
 这里的第7行进入 `AbstractClusterInvoker` 中的 `invoke` 方法：
 
 ```java
 @Override
public Result invoke(final Invocation invocation) throws RpcException {
    checkWhetherDestroyed();
    LoadBalance loadbalance = null;
    List<Invoker<T>> invokers = list(invocation);
    if (invokers != null && !invokers.isEmpty()) {
        loadbalance = ExtensionLoader.getExtensionLoader(LoadBalance.class).getExtension(invokers.get(0).getUrl()
                .getMethodParameter(invocation.getMethodName(), Constants.LOADBALANCE_KEY, Constants.DEFAULT_LOADBALANCE));
    }
    RpcUtils.attachInvocationIdIfAsync(getUrl(), invocation);
    return doInvoke(invocation, invokers, loadbalance);
}
...

protected List<Invoker<T>> list(Invocation invocation) throws RpcException {
    List<Invoker<T>> invokers = directory.list(invocation);
    return invokers;
}
 ```
 
这里可以看到，在 `list` 方法中调用了 `directory` 的 `list` 方法，这里的 `directory` 对象就是 `RegistryDirectory` 类型的对象，这里首先会调用 `AbstractDirectory` 中的 `list` 方法，然后再调用子类自己实现的 `doList` 方法：

`AbstractDirectory` 中的 `list` 方法：

```java
@Override
public List<Invoker<T>> list(Invocation invocation) throws RpcException {
    if (destroyed) {
        throw new RpcException("Directory already destroyed .url: " + getUrl());
    }
    List<Invoker<T>> invokers = doList(invocation);
    List<Router> localRouters = this.routers; // local reference
    if (localRouters != null && !localRouters.isEmpty()) {
        for (Router router : localRouters) {
            try {
                if (router.getUrl() == null || router.getUrl().getParameter(Constants.RUNTIME_KEY, false)) {
                    invokers = router.route(invokers, getConsumerUrl(), invocation);
                }
            } catch (Throwable t) {
                logger.error("Failed to execute router: " + getUrl() + ", cause: " + t.getMessage(), t);
            }
        }
    }
    return invokers;
}
```

该方法主要有两个工作：

* 调用具体的 `Directory` 列出可用的服务提供者；
* 根据路由规则过滤。

这里先不考虑路由，看下 `RegistryDirectory` 中的 `doList` 方法：

```java
@Override
public List<Invoker<T>> doList(Invocation invocation) {
    if (forbidden) {
        // 1. No service provider 2. Service providers are disabled
        throw new RpcException(RpcException.FORBIDDEN_EXCEPTION,
            "No provider available from registry " + getUrl().getAddress() + " for service " + getConsumerUrl().getServiceKey() + " on consumer " +  NetUtils.getLocalHost()
                    + " use dubbo version " + Version.getVersion() + ", please check status of providers(disabled, not registered or in blacklist).");
    }
    List<Invoker<T>> invokers = null;
    Map<String, List<Invoker<T>>> localMethodInvokerMap = this.methodInvokerMap; // local reference
    if (localMethodInvokerMap != null && localMethodInvokerMap.size() > 0) {
        String methodName = RpcUtils.getMethodName(invocation);
        Object[] args = RpcUtils.getArguments(invocation);
        if (args != null && args.length > 0 && args[0] != null
                && (args[0] instanceof String || args[0].getClass().isEnum())) {
            invokers = localMethodInvokerMap.get(methodName + "." + args[0]); // The routing can be enumerated according to the first parameter
        }
        if (invokers == null) {
            invokers = localMethodInvokerMap.get(methodName);
        }
        if (invokers == null) {
            invokers = localMethodInvokerMap.get(Constants.ANY_VALUE);
        }
        if (invokers == null) {
            Iterator<List<Invoker<T>>> iterator = localMethodInvokerMap.values().iterator();
            if (iterator.hasNext()) {
                invokers = iterator.next();
            }
        }
    }
    return invokers == null ? new ArrayList<Invoker<T>>(0) : invokers;
}
```

这里的核心是 `this.methodInvokerMap`，`Directory` 获取 `invoker` 就是根据这个值，那么该值是在哪里被更新的呢？

由于是使用的 `zookeeper` 注册中心，看下上面的类图可以知道，是通过 `ZookeeperRegistry` 来进行更新的，`ZookeeperRegistry` 继承自 `FailbackRegistry` ，在 `FailbackRegistry` 中的 `subscribe` 方法会调用 `ZookeeperRegistry` 实现的 `doSubscribe` 方法进行更新：

```java
@Override
public void subscribe(URL url, NotifyListener listener) {
    super.subscribe(url, listener);
    removeFailedSubscribed(url, listener);
    try {
        // Sending a subscription request to the server side
        doSubscribe(url, listener);
    } catch (Exception e) {
        ...
    }
}
```

从上面的类图可以看到，`RegistryDirectory` 实现了 `NotifyListener` 接口，该接口定义了一个 `notify` 方法，`doSubscribe` 方法执行的最终会调用 `RegistryDirectory` 中的 `notify` 方法。

看下 `notify` 方法的实现，这里简化了一下代码：

```java
@Override
public synchronized void notify(List<URL> urls) {
    List<URL> invokerUrls = new ArrayList<URL>();
    for (URL url : urls) {
        String protocol = url.getProtocol();
        String category = url.getParameter(Constants.CATEGORY_KEY, Constants.DEFAULT_CATEGORY);
        if (Constants.ROUTERS_CATEGORY.equals(category)
                ...
        } else if (Constants.PROVIDERS_CATEGORY.equals(category)) {
            invokerUrls.add(url);
        } 
        ...
    }
    ...
    // providers
    refreshInvoker(invokerUrls);
}
```

`refreshInvoker` 进行 `methodInvokerMap` 的更新：

```java
private void refreshInvoker(List<URL> invokerUrls) {
    if (invokerUrls != null && invokerUrls.size() == 1 && invokerUrls.get(0) != null
            && Constants.EMPTY_PROTOCOL.equals(invokerUrls.get(0).getProtocol())) {
        this.forbidden = true; // Forbid to access
        this.methodInvokerMap = null; // Set the method invoker map to null
        destroyAllInvokers(); // Close all invokers
    } else {
        ...
        Map<String, Invoker<T>> newUrlInvokerMap = toInvokers(invokerUrls);// Translate url list to Invoker map
        Map<String, List<Invoker<T>>> newMethodInvokerMap = toMethodInvokers(newUrlInvokerMap); // Change method name to map Invoker Map
        ...
        this.methodInvokerMap = multiGroup ? toMergeMethodInvokerMap(newMethodInvokerMap) : newMethodInvokerMap;
        this.urlInvokerMap = newUrlInvokerMap;
        try {
            destroyUnusedInvokers(oldUrlInvokerMap, newUrlInvokerMap); // Close the unused Invoker
        } catch (Exception e) {
            logger.warn("destroyUnusedInvokers error. ", e);
        }
    }
}
```
我们回到 `AbstractClusterInvoker` 中的 `invoke` 方法，再来看一下该方法：

```java
 @Override
public Result invoke(final Invocation invocation) throws RpcException {
    checkWhetherDestroyed();
    LoadBalance loadbalance = null;
    List<Invoker<T>> invokers = list(invocation);
    if (invokers != null && !invokers.isEmpty()) {
        loadbalance = ExtensionLoader.getExtensionLoader(LoadBalance.class).getExtension(invokers.get(0).getUrl()
                .getMethodParameter(invocation.getMethodName(), Constants.LOADBALANCE_KEY, Constants.DEFAULT_LOADBALANCE));
    }
    RpcUtils.attachInvocationIdIfAsync(getUrl(), invocation);
    return doInvoke(invocation, invokers, loadbalance);
}
```

通过上面的分析可知，在 `list` 方法中，已经经过了 `Directory` 和 `Router` ，按照官网给出的集群容错的图，可以知道，下一步应该是 `LoadBalance`，从代码中也可以看到通过 `SPI` 来获取具体的 `LoadBalance`，然后执行具体的调用。

## 实例分析

下面来具体实践一下。启动两个服务，名字分别为 `demo-provider-1` 和 `demo-provider-2`：

{% asset_img "providers.png" %}

启动一个消费者，名字为 `demo-consumer-2`：

{% asset_img "consumer.png" %}

在执行到 `invoke` 方法时，查看获取的 `list` ：

{% asset_img "invokers.png" %}

查看消费者的通知信息：

{% asset_img "consumer-notify.png" %}

至此， `Directory` 的分析就结束了，下篇文章会分析一下 `Router` 的实现。
