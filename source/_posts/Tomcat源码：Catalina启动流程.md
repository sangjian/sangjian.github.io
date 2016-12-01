---
title: Tomcat源码：Catalina启动流程
date: 2016-11-27 00:10:55
categories: Tomcat源码
tags: Tomcat
---

上篇文章分析了`Bootstrap`类的启动流程，可以知道，`Bootstrap`实际上是调用了`Catalina`类的对象来实现Tomcat的启动的，这篇文章来介绍一下`Catalina`类的启动流程。

回顾一下`Bootstrap`中main方法执行启动时的代码：

```java
if (command.equals("start")) {
    daemon.setAwait(true);
    daemon.load(args);
    daemon.start();
}
```

下面介绍Catalina类中的方法。

<!-- more -->

## await方法

`daemon.setAwait(true);`表示该Tomcat已经执行了启动，也是调用了`Catalina`中的`setAwait`方法：

```java
/**
 * Await and shutdown.
 */
public void await() {

    getServer().await();

}
```

这里又调用的`Server`的`await`方法，`await`方法的作用就是判断当前启动的Server所要绑定的端口（默认是8005）是否被占用，如果被占用，则会抛出以下异常：

```
严重: StandardServer.await: create[localhost:8005]: 
java.net.BindException: Address already in use
	at java.net.PlainSocketImpl.socketBind(Native Method)
	at java.net.AbstractPlainSocketImpl.bind(AbstractPlainSocketImpl.java:387)
	at java.net.ServerSocket.bind(ServerSocket.java:375)
	at java.net.ServerSocket.<init>(ServerSocket.java:237)
	at org.apache.catalina.core.StandardServer.await(StandardServer.java:441)
	at org.apache.catalina.startup.Catalina.await(Catalina.java:743)
	at org.apache.catalina.startup.Catalina.start(Catalina.java:689)
	at sun.reflect.NativeMethodAccessorImpl.invoke0(Native Method)
	at sun.reflect.NativeMethodAccessorImpl.invoke(NativeMethodAccessorImpl.java:62)
	at sun.reflect.DelegatingMethodAccessorImpl.invoke(DelegatingMethodAccessorImpl.java:43)
	at java.lang.reflect.Method.invoke(Method.java:497)
	at org.apache.catalina.startup.Bootstrap.start(Bootstrap.java:355)
	at org.apache.catalina.startup.Bootstrap.main(Bootstrap.java:495)
```

## load方法

`Bootstrap`类中的`load`方法会调用`Catalina`中的`load`方法，`Catalina`中的`load`代码如下：

```java
/**
 * Start a new server instance.
 */
public void load() {

    long t1 = System.nanoTime();

    initDirs();

    // Before digester - it may be needed
    initNaming();

    //使用Digester创建server.xml文件的对象，生成相应的处理规则
    // Create and execute our Digester
    Digester digester = createStartDigester();

    InputSource inputSource = null;
    InputStream inputStream = null;
    File file = null;
    try {
        try {
            // 获取配置文件，server.xml
            file = configFile();
            inputStream = new FileInputStream(file);
            inputSource = new InputSource(file.toURI().toURL().toString());
        } catch (Exception e) {
            if (log.isDebugEnabled()) {
                log.debug(sm.getString("catalina.configFail", file), e);
            }
        }
        if (inputStream == null) {
            try {
                inputStream = getClass().getClassLoader()
                    .getResourceAsStream(getConfigFile());
                inputSource = new InputSource
                    (getClass().getClassLoader()
                     .getResource(getConfigFile()).toString());
            } catch (Exception e) {
                if (log.isDebugEnabled()) {
                    log.debug(sm.getString("catalina.configFail",
                            getConfigFile()), e);
                }
            }
        }

        // This should be included in catalina.jar
        // Alternative: don't bother with xml, just create it manually.
        if (inputStream == null) {
            try {
                inputStream = getClass().getClassLoader()
                        .getResourceAsStream("server-embed.xml");
                inputSource = new InputSource
                (getClass().getClassLoader()
                        .getResource("server-embed.xml").toString());
            } catch (Exception e) {
                if (log.isDebugEnabled()) {
                    log.debug(sm.getString("catalina.configFail",
                            "server-embed.xml"), e);
                }
            }
        }


        if (inputStream == null || inputSource == null) {
            if  (file == null) {
                log.warn(sm.getString("catalina.configFail",
                        getConfigFile() + "] or [server-embed.xml]"));
            } else {
                log.warn(sm.getString("catalina.configFail",
                        file.getAbsolutePath()));
                if (file.exists() && !file.canRead()) {
                    log.warn("Permissions incorrect, read permission is not allowed on the file.");
                }
            }
            return;
        }

        try {
            inputSource.setByteStream(inputStream);
            
            //将Catalina对象压入栈底，server对象生成之后会调用当前对象的setServer方法来设置server对象
            digester.push(this);
            digester.parse(inputSource);
        } catch (SAXParseException spe) {
            log.warn("Catalina.start using " + getConfigFile() + ": " +
                    spe.getMessage());
            return;
        } catch (Exception e) {
            log.warn("Catalina.start using " + getConfigFile() + ": " , e);
            return;
        }
    } finally {
        if (inputStream != null) {
            try {
                inputStream.close();
            } catch (IOException e) {
                // Ignore
            }
        }
    }

    getServer().setCatalina(this);
    getServer().setCatalinaHome(Bootstrap.getCatalinaHomeFile());
    getServer().setCatalinaBase(Bootstrap.getCatalinaBaseFile());

    // Stream redirection
    initStreams();

    // Start the new server
    try {
        // 初始化server
        getServer().init();
    } catch (LifecycleException e) {
        if (Boolean.getBoolean("org.apache.catalina.startup.EXIT_ON_INIT_FAILURE")) {
            throw new java.lang.Error(e);
        } else {
            log.error("Catalina.start", e);
        }
    }

    long t2 = System.nanoTime();
    if(log.isInfoEnabled()) {
        log.info("Initialization processed in " + ((t2 - t1) / 1000000) + " ms");
    }
}
```

该方法主要的工作是：

1. 解析server.xml配置文件
2. 根据server.xml文件创建对象，包括server，listener，service，connector，container等等
3. 初始化上面创建的对象

## server.xml文件结构

在往下看之前，还是说一下`server.xml`的文件结构吧，也好参考的代码做对比，结构如下：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Server port="8005" shutdown="SHUTDOWN">
  <Listener className="org.apache.catalina.startup.VersionLoggerListener" />
  ...

  <GlobalNamingResources>
    <Resource name="UserDatabase" auth="Container"
              type="org.apache.catalina.UserDatabase"
              description="User database that can be updated and saved"
              factory="org.apache.catalina.users.MemoryUserDatabaseFactory"
              pathname="conf/tomcat-users.xml" />
  </GlobalNamingResources>

  <Service name="Catalina">

    
    <Executor name="tomcatThreadPool" namePrefix="catalina-exec-"
        maxThreads="150" minSpareThreads="4"/>
    ...

    <Connector port="8080" protocol="HTTP/1.1"
               connectionTimeout="20000"
               redirectPort="8443" />
   ...

    

    <Engine name="Catalina" defaultHost="localhost">

     

      <!-- Use the LockOutRealm to prevent attempts to guess user passwords
           via a brute-force attack -->
      <Realm className="org.apache.catalina.realm.LockOutRealm">
        <Realm className="org.apache.catalina.realm.UserDatabaseRealm"
               resourceName="UserDatabase"/>
      </Realm>

      <Host name="localhost"  appBase="webapps"
            unpackWARs="true" autoDeploy="true">

        
        <Valve className="org.apache.catalina.authenticator.SingleSignOn" />
        ...
        <Context>...</Context>
      </Host>
    </Engine>
  </Service>
</Server>

```
这里列出了大概的结构，接下来说明是解析`server.xml`的流程。


## createStartDigester方法

该方法负责创建一个`Digester`对象，代码如下：

```java
/**
 * Create and configure the Digester we will be using for startup.
 * @return the main digester to parse server.xml
 */
protected Digester createStartDigester() {
    long t1=System.currentTimeMillis();
    // Initialize the digester
    Digester digester = new Digester();
    digester.setValidating(false);
    digester.setRulesValidation(true);
    HashMap<Class<?>, List<String>> fakeAttributes = new HashMap<>();
    ArrayList<String> attrs = new ArrayList<>();
    attrs.add("className");
    fakeAttributes.put(Object.class, attrs);
    digester.setFakeAttributes(fakeAttributes);
    digester.setUseContextClassLoader(true);
    
    // 增加创建server对象的规则
    // Configure the actions we will be using
    digester.addObjectCreate("Server",
                             "org.apache.catalina.core.StandardServer",
                             "className");
    // 增加设置Server属性的规则，用户在Server对象创建完之后设置Server对象的属性值
    digester.addSetProperties("Server");
    // Server对象创建完成后，会调用它前一个对象的setServer方法，并把自己作为参数
    digester.addSetNext("Server",
                        "setServer",
                        "org.apache.catalina.Server");

    digester.addObjectCreate("Server/GlobalNamingResources",
                             "org.apache.catalina.deploy.NamingResourcesImpl");
    digester.addSetProperties("Server/GlobalNamingResources");
    digester.addSetNext("Server/GlobalNamingResources",
                        "setGlobalNamingResources",
                        "org.apache.catalina.deploy.NamingResourcesImpl");

    //创建listener，其中第二个参数为空，表示必须在配置文件中指定className
    digester.addObjectCreate("Server/Listener",
                             null, // MUST be specified in the element
                             "className");
    digester.addSetProperties("Server/Listener");
    digester.addSetNext("Server/Listener",
                        "addLifecycleListener",
                        "org.apache.catalina.LifecycleListener");

    digester.addObjectCreate("Server/Service",
                             "org.apache.catalina.core.StandardService",
                             "className");
    digester.addSetProperties("Server/Service");
    digester.addSetNext("Server/Service",
                        "addService",
                        "org.apache.catalina.Service");

    digester.addObjectCreate("Server/Service/Listener",
                             null, // MUST be specified in the element
                             "className");
    digester.addSetProperties("Server/Service/Listener");
    digester.addSetNext("Server/Service/Listener",
                        "addLifecycleListener",
                        "org.apache.catalina.LifecycleListener");

    //Executor
    digester.addObjectCreate("Server/Service/Executor",
                     "org.apache.catalina.core.StandardThreadExecutor",
                     "className");
    digester.addSetProperties("Server/Service/Executor");

    digester.addSetNext("Server/Service/Executor",
                        "addExecutor",
                        "org.apache.catalina.Executor");


    digester.addRule("Server/Service/Connector",
                     new ConnectorCreateRule());
    digester.addRule("Server/Service/Connector",
                     new SetAllPropertiesRule(new String[]{"executor", "sslImplementationName"}));
    digester.addSetNext("Server/Service/Connector",
                        "addConnector",
                        "org.apache.catalina.connector.Connector");

    digester.addObjectCreate("Server/Service/Connector/SSLHostConfig",
                             "org.apache.tomcat.util.net.SSLHostConfig");
    digester.addSetProperties("Server/Service/Connector/SSLHostConfig");
    digester.addSetNext("Server/Service/Connector/SSLHostConfig",
            "addSslHostConfig",
            "org.apache.tomcat.util.net.SSLHostConfig");

    digester.addRule("Server/Service/Connector/SSLHostConfig/Certificate",
                     new CertificateCreateRule());
    digester.addRule("Server/Service/Connector/SSLHostConfig/Certificate",
                     new SetAllPropertiesRule(new String[]{"type"}));
    digester.addSetNext("Server/Service/Connector/SSLHostConfig/Certificate",
                        "addCertificate",
                        "org.apache.tomcat.util.net.SSLHostConfigCertificate");

    digester.addObjectCreate("Server/Service/Connector/Listener",
                             null, // MUST be specified in the element
                             "className");
    digester.addSetProperties("Server/Service/Connector/Listener");
    digester.addSetNext("Server/Service/Connector/Listener",
                        "addLifecycleListener",
                        "org.apache.catalina.LifecycleListener");

    digester.addObjectCreate("Server/Service/Connector/UpgradeProtocol",
                              null, // MUST be specified in the element
                              "className");
    digester.addSetProperties("Server/Service/Connector/UpgradeProtocol");
    digester.addSetNext("Server/Service/Connector/UpgradeProtocol",
                        "addUpgradeProtocol",
                        "org.apache.coyote.UpgradeProtocol");

    // Add RuleSets for nested elements
    digester.addRuleSet(new NamingRuleSet("Server/GlobalNamingResources/"));
    digester.addRuleSet(new EngineRuleSet("Server/Service/"));
    digester.addRuleSet(new HostRuleSet("Server/Service/Engine/"));
    digester.addRuleSet(new ContextRuleSet("Server/Service/Engine/Host/"));
    addClusterRuleSet(digester, "Server/Service/Engine/Host/Cluster/");
    digester.addRuleSet(new NamingRuleSet("Server/Service/Engine/Host/Context/"));

    // When the 'engine' is found, set the parentClassLoader.
    digester.addRule("Server/Service/Engine",
                     new SetParentClassLoaderRule(parentClassLoader));
    addClusterRuleSet(digester, "Server/Service/Engine/Cluster/");

    long t2=System.currentTimeMillis();
    if (log.isDebugEnabled()) {
        log.debug("Digester for server.xml created " + ( t2-t1 ));
    }
    return (digester);

}
```

上面我只注释了创建Server对象的部分，其他的原理都类似，就不多说了，这里要注意一个地方：

```java
// Server对象创建完成后，会调用它前一个对象的setServer方法，并把自己作为参数
digester.addSetNext("Server", "setServer", "org.apache.catalina.Server");
```

回顾一下`load`方法中的这段代码：

```java
//将Catalina对象压入栈底，server对象生成之后会调用当前对象的setServer方法来设置server对象
digester.push(this);
digester.parse(inputSource);
```

意思就是把当前的`Catalina`对象压入栈底，然后解析配置文件。所以在Server对象创建完成后，会调用`Catalina`对象的setServer方法。

这里简单介绍一下`Digester`解析的原理：

* Digester实例有一个内部栈用来临时存储对象。当addObjectCreate方法实例化一个类时，就将结果放到栈中。
* 当调用两个addObjectCreate方法时，第一个对象首先放入栈中，接着是第二个对象。
* addSetNext方法用于创建两个对象之间的关系，其通过调用第一个对象指定的方法并以第二个对象作为参数传递给这个方法。

有关`Digester`库的更详细的用法，请自行查找相关资料。

## start方法

这里才是真正启动tomcat的代码：

```java
/**
 * Start a new server instance.
 */
public void start() {

    if (getServer() == null) {
        load();
    }

    if (getServer() == null) {
        log.fatal("Cannot start server. Server instance is not configured.");
        return;
    }

    long t1 = System.nanoTime();

    // Start the new server
    try {
        // 启动server
        getServer().start();
    } catch (LifecycleException e) {
        log.fatal(sm.getString("catalina.serverStartFail"), e);
        try {
            getServer().destroy();
        } catch (LifecycleException e1) {
            log.debug("destroy() failed for failed Server ", e1);
        }
        return;
    }

    long t2 = System.nanoTime();
    if(log.isInfoEnabled()) {
        log.info("Server startup in " + ((t2 - t1) / 1000000) + " ms");
    }

    // Register shutdown hook
    if (useShutdownHook) {
        if (shutdownHook == null) {
            shutdownHook = new CatalinaShutdownHook();
        }
        Runtime.getRuntime().addShutdownHook(shutdownHook);

        // If JULI is being used, disable JULI's shutdown hook since
        // shutdown hooks run in parallel and log messages may be lost
        // if JULI's hook completes before the CatalinaShutdownHook()
        LogManager logManager = LogManager.getLogManager();
        if (logManager instanceof ClassLoaderLogManager) {
            ((ClassLoaderLogManager) logManager).setUseShutdownHook(
                    false);
        }
    }

    if (await) {
        await();
        stop();
    }
}
```
`await`在开头已经讨论过，就不说了。这里的`getServer().start()`是负责启动server对象的，其实server对象需要做的只是启动`globalNamingResources`和`service`，进而会启动整个tomcat，通过上面给出的`server.xml`文件的结构也可以知道，因为`GlobalNamingResources`和`Service`是`Server`的子元素。

## 总结

至此，`Catalina`的初始化和启动工作流程算是完成了。

由[上一篇：Tomcat源码：Bootstrap启动流程](/2016/11/26/Tomcat源码：Bootstrap启动流程/)和这篇文章来看，我们已经大概了解了tomcat的启动过程，所以可以总结出来tomcat的各个组件的层次关系大概如下图所示：

{% asset_img "tomcat-components.png" %}

层次结构还算比较清晰的，接下来就是各个组件的初始化和启动的工作流程，这些流程后续有时间也会详细讨论。

睡觉。。。
