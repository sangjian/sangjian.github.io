---
title: Dubbo源码分析：Router
date: 2018-05-14 22:51:00
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

上篇文章介绍了 `Directory` ，再次看一下dubbo调用的处理流程：

{% asset_img "cluster.jpg" %}

本篇文章介绍调用的第二步， `Router` 的实现。

从图中可以看到， `Router` 的实现有两种： `Script` 和 `Condition`，官网对其的描述为：

> `Router` 负责从多个 `Invoker` 中按路由规则选出子集，比如读写分离，应用隔离等

也就是说，第一步通过 `Directory` 选出当前可用的服务提供者，然后再通过 `Router` 按规则过滤出服务提供者的子集。

<!-- more -->

## 使用示例

我们先看一下具体的使用。还是启动两个 `provider` ，端口分别为20880和20881：

{% asset_img "providers.png" %}

启动 `consumer` 查看控制台的输出：

```
Hello world, response from provider: 192.168.199.203:20881
Hello world, response from provider: 192.168.199.203:20880
Hello world, response from provider: 192.168.199.203:20881
Hello world, response from provider: 192.168.199.203:20881
Hello world, response from provider: 192.168.199.203:20880
Hello world, response from provider: 192.168.199.203:20880
Hello world, response from provider: 192.168.199.203:20880
Hello world, response from provider: 192.168.199.203:20880
Hello world, response from provider: 192.168.199.203:20881
```

可以看到 `consumer` 的调用会被路由到这两个服务提供者。

新建一个路由规则：

{% asset_img "router-rule.png" %}

这里会切断端口为20880的流量，使 `consumer` 的调用只能路由到20881上，保存之后在页面点击启用：

{% asset_img "enable-rule.png" %}

这时再看下控制台的输出：

```
Hello world, response from provider: 192.168.199.203:20881
Hello world, response from provider: 192.168.199.203:20881
Hello world, response from provider: 192.168.199.203:20881
Hello world, response from provider: 192.168.199.203:20881
Hello world, response from provider: 192.168.199.203:20881
Hello world, response from provider: 192.168.199.203:20881
Hello world, response from provider: 192.168.199.203:20881
Hello world, response from provider: 192.168.199.203:20881
Hello world, response from provider: 192.168.199.203:20881
```

可见，路由的规则起作用了。

## 代码分析

看下 `Router` 的类图：

{% asset_img "router.png" %}

它的主要实现类有两个，`ConditionRouter` 和 `ScriptRouter`。在刚才的示例中使用了 `ConditionRouter`。这里先分析一下 `ConditionRouter` 的实现。

分析一下，当新建一个路由规则时，会在zookeeper中新建一个节点：

{% asset_img "zookeeper-router.png" %}

根据上篇文章的分析，会调用 `RegistryDirectory` 中的 `notify` 方法进行通知：

```java
@Override
public synchronized void notify(List<URL> urls) {
    List<URL> invokerUrls = new ArrayList<URL>();
    List<URL> routerUrls = new ArrayList<URL>();
    List<URL> configuratorUrls = new ArrayList<URL>();
    for (URL url : urls) {
        String protocol = url.getProtocol();
        String category = url.getParameter(Constants.CATEGORY_KEY, Constants.DEFAULT_CATEGORY);
        if (Constants.ROUTERS_CATEGORY.equals(category)
                || Constants.ROUTE_PROTOCOL.equals(protocol)) {
            routerUrls.add(url);
        } else if (Constants.CONFIGURATORS_CATEGORY.equals(category)
                || Constants.OVERRIDE_PROTOCOL.equals(protocol)) {
            configuratorUrls.add(url);
        } else if (Constants.PROVIDERS_CATEGORY.equals(category)) {
            invokerUrls.add(url);
        } else {
            logger.warn("Unsupported category " + category + " in notified url: " + url + " from registry " + getUrl().getAddress() + " to consumer " + NetUtils.getLocalHost());
        }
    }
    // configurators
    if (configuratorUrls != null && !configuratorUrls.isEmpty()) {
        this.configurators = toConfigurators(configuratorUrls);
    }
    // routers
    if (routerUrls != null && !routerUrls.isEmpty()) {
        List<Router> routers = toRouters(routerUrls);
        if (routers != null) { // null - do nothing
            setRouters(routers);
        }
    }
    List<Configurator> localConfigurators = this.configurators; // local reference
    // merge override parameters
    this.overrideDirectoryUrl = directoryUrl;
    if (localConfigurators != null && !localConfigurators.isEmpty()) {
        for (Configurator configurator : localConfigurators) {
            this.overrideDirectoryUrl = configurator.configure(overrideDirectoryUrl);
        }
    }
    // providers
    refreshInvoker(invokerUrls);
}
```

注意这里的 `toRouters` 方法，该方法通过传入的url转成 `Router` 对象：

```java
private List<Router> toRouters(List<URL> urls) {
    List<Router> routers = new ArrayList<Router>();
    if (urls == null || urls.isEmpty()) {
        return routers;
    }
    if (urls != null && !urls.isEmpty()) {
        for (URL url : urls) {
            if (Constants.EMPTY_PROTOCOL.equals(url.getProtocol())) {
                continue;
            }
            String routerType = url.getParameter(Constants.ROUTER_KEY);
            if (routerType != null && routerType.length() > 0) {
                url = url.setProtocol(routerType);
            }
            try {
                Router router = routerFactory.getRouter(url);
                if (!routers.contains(router))
                    routers.add(router);
            } catch (Throwable t) {
                logger.error("convert router url to router error, url: " + url, t);
            }
        }
    }
    return routers;
}
```

看下url的值：

```
condition://0.0.0.0/com.alibaba.dubbo.demo.DemoService?category=routers&dynamic=false&enabled=true&force=false&name=切断provider1的流量&priority=0&router=condition&rule=+%3D%3E+provider.port+%21%3D+20880&runtime=false
```

官网的介绍如下：

* `condition://` 表示路由规则的类型，支持条件路由规则和脚本路由规则，可扩展，**必填**。
* `0.0.0.0` 表示对所有 IP 地址生效，如果只想对某个 IP 的生效，请填入具体 IP，**必填**。
* `com.foo.BarService` 表示只对指定服务生效，**必填**。
* `category=routers` 表示该数据为动态配置类型，**必填**。
* `dynamic=false` 表示该数据为持久数据，当注册方退出时，数据依然保存在注册中心，**必填**。
* `enabled=true` 覆盖规则是否生效，可不填，缺省生效。
* `force=false` 当路由结果为空时，是否强制执行，如果不强制执行，路由结果为空的路由规则将自动失效，可不填，缺省为 flase。
* `runtime=false` 是否在每次调用时执行路由规则，否则只在提供者地址列表变更时预先执行并缓存结果，调用时直接从缓存中获取路由结果。如果用了参数路由，必须设为 true，需要注意设置会影响调用的性能，可不填，缺省为 flase。
* `priority=1` 路由规则的优先级，用于排序，优先级越大越靠前执行，可不填，缺省为 0。
* `rule=URL.encode("host = 10.20.153.10 => host = 10.20.153.11")` 表示路由规则的内容，**必填**。



通过 `routerFactory.getRouter(url);` 会创建一个 `Router` 对象，这里的 `routerFactory` 就是 `ConditionRouterFactory` 类型， `getRouter` 方法会直接返回一个 `ConditionRouter` 对象：

```java
public class ConditionRouterFactory implements RouterFactory {

    public static final String NAME = "condition";

    @Override
    public Router getRouter(URL url) {
        return new ConditionRouter(url);
    }

}
```
查看一下 `ConditionRouter` 的构造方法：

```java
public ConditionRouter(URL url) {
    this.url = url;
    this.priority = url.getParameter(Constants.PRIORITY_KEY, 0);
    this.force = url.getParameter(Constants.FORCE_KEY, false);
    try {
        String rule = url.getParameterAndDecoded(Constants.RULE_KEY);
        if (rule == null || rule.trim().length() == 0) {
            throw new IllegalArgumentException("Illegal route rule!");
        }
        rule = rule.replace("consumer.", "").replace("provider.", "");
        int i = rule.indexOf("=>");
        String whenRule = i < 0 ? null : rule.substring(0, i).trim();
        String thenRule = i < 0 ? rule.trim() : rule.substring(i + 2).trim();
        Map<String, MatchPair> when = StringUtils.isBlank(whenRule) || "true".equals(whenRule) ? new HashMap<String, MatchPair>() : parseRule(whenRule);
        Map<String, MatchPair> then = StringUtils.isBlank(thenRule) || "false".equals(thenRule) ? null : parseRule(thenRule);
        // NOTE: It should be determined on the business level whether the `When condition` can be empty or not.
        this.whenCondition = when;
        this.thenCondition = then;
    } catch (ParseException e) {
        throw new IllegalStateException(e.getMessage(), e);
    }
}
```

具体的条件路由规则请参考官方文档。构造方法中解析了路由规则，分成两个部分： `whenCondition` 和 `thenCondition`，在 `route` 方法中可以看到具体的判断：

```java
@Override
public <T> List<Invoker<T>> route(List<Invoker<T>> invokers, URL url, Invocation invocation)
        throws RpcException {
    if (invokers == null || invokers.isEmpty()) {
        return invokers;
    }
    try {
        // 当不满足when条件时，返回
        if (!matchWhen(url, invocation)) {
            return invokers;
        }
        List<Invoker<T>> result = new ArrayList<Invoker<T>>();
        if (thenCondition == null) {
            logger.warn("The current consumer in the service blacklist. consumer: " + NetUtils.getLocalHost() + ", service: " + url.getServiceKey());
            return result;
        }
        for (Invoker<T> invoker : invokers) {
            // 满足then条件时，添加到结果列表
            if (matchThen(invoker.getUrl(), url)) {
                result.add(invoker);
            }
        }
        if (!result.isEmpty()) {
            return result;
        } else if (force) {
            logger.warn("The route result is empty and force execute. consumer: " + NetUtils.getLocalHost() + ", service: " + url.getServiceKey() + ", router: " + url.getParameterAndDecoded(Constants.RULE_KEY));
            return result;
        }
    } catch (Throwable t) {
        logger.error("Failed to execute condition router rule: " + getUrl() + ", invokers: " + invokers + ", cause: " + t.getMessage(), t);
    }
    return invokers;
}
```

现在回到 `RegistryDirectory` 中的 `notify` 方法，当得到了路由列表后，会将路由列表设置到当前的 `Directory` 中，通过调用 `setRouters` 方法进行设置：

```java
protected void setRouters(List<Router> routers) {
    // copy list
    routers = routers == null ? new ArrayList<Router>() : new ArrayList<Router>(routers);
    // append url router
    String routerkey = url.getParameter(Constants.ROUTER_KEY);
    if (routerkey != null && routerkey.length() > 0) {
        RouterFactory routerFactory = ExtensionLoader.getExtensionLoader(RouterFactory.class).getExtension(routerkey);
        routers.add(routerFactory.getRouter(url));
    }
    // append mock invoker selector
    routers.add(new MockInvokersSelector());
    Collections.sort(routers);
    this.routers = routers;
}
```

那么，具体是怎么调用 `route` 方法的呢？我们结合上篇对 `Directory` 的介绍来分析，回顾一下在 `RegisterDirectory` 中的 `doList` 方法执行时会通过 `methodInvokerMap` 变量来获取 `invokers`，具体的调用如下：

{% asset_img "getInvokers.png" %}

那么，是什么时候设置 `methodInvokerMap` 的呢？这个是在注册中心发生变更的时候，比如新增服务提供者或者新增路由规则，这时会触发 `RegistryDirectory` 的 `notify` 方法：

{% asset_img "setToMethodInvokers.png" %}

至此，整个路由服务的分析就结束了。结合上篇文章我们就可以知道， `Directory` 的功能了：

* 监听注册中心节点的变化，如果有节点新增或者删除，就会触发 `notify` 方法来更新；
* 当获取了当前服务的 `Invoker` 列表后，如果配置了路由规则，则使用该路由规则过滤 `Invoker` 列表。
