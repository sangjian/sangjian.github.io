---
title: Java线程上下文加载器与SPI
date: 2018-02-10 19:10:50
categories: 开发手册
tags: Java
---

## SPI机制

SPI的全名为Service Provider Interface.大多数开发人员可能不熟悉，因为这个是针对厂商或者插件的。在`java.util.ServiceLoader`的文档里有比较详细的介绍。简单的总结下java spi机制的思想。我们系统里抽象的各个模块，往往有很多不同的实现方案，比如日志模块的方案，xml解析模块、jdbc模块的方案等。面向的对象的设计里，我们一般推荐模块之间基于接口编程，模块之间不对实现类进行硬编码。一旦代码里涉及具体的实现类，就违反了可拔插的原则，如果需要替换一种实现，就需要修改代码。为了实现在模块装配的时候能不在程序里动态指明，这就需要一种服务发现机制。 java spi就是提供这样的一个机制：为某个接口寻找服务实现的机制。有点类似IOC的思想，就是将装配的控制权移到程序之外，在模块化设计中这个机制尤其重要。

<!-- more -->

## SPI具体约定

java spi的具体约定为:当服务的提供者，提供了服务接口的一种实现之后，在jar包的META-INF/services/目录里同时创建一个以服务接口命名的文件。该文件里就是实现该服务接口的具体实现类。而当外部程序装配这个模块的时候，就能通过该jar包META-INF/services/里的配置文件找到具体的实现类名，并装载实例化，完成模块的注入。 基于这样一个约定就能很好的找到服务接口的实现类，而不需要再代码里制定。jdk提供服务实现查找的一个工具类：`java.util.ServiceLoader`

## 应用场景

1. common-logging：apache最早提供的日志的门面接口。只有接口，没有实现。具体方案由各提供商实现， 发现日志提供商是通过扫描 `META-INF/services/org.apache.commons.logging.LogFactory`配置文件，通过读取该文件的内容找到日志提工商实现类。只要我们的日志实现里包含了这个文件，并在文件里制定`LogFactory`工厂接口的实现类即可。
2. JDBC：jdbc4.0以前， 开发人员还需要基于`Class.forName("xxx")`的方式来装载驱动，jdbc4也基于spi的机制来发现驱动提供商了，可以通过`META-INF/services/java.sql.Driver`文件里指定实现类的方式来暴露驱动提供者.

## SPI的使用

首先，创建一个缓存数据源接口：

```java
public interface CacheDataSource {

    String getDataSource();
}
```

接下来创建了两个实现类：

```java
public class DatabaseCacheDataSource implements CacheDataSource {
    @Override
    public String getDataSource() {
        System.out.println(this.getClass().getClassLoader());
        System.out.println("DatabaseCacheDataSource");
        return null;
    }
}

public class MemoryCacheDataSource implements CacheDataSource {
    @Override
    public String getDataSource() {
        System.out.println(this.getClass().getClassLoader());
        System.out.println("MemoryCacheDataSource");
        return null;
    }
}
```

最后我们在META-INF/services目录下新建一个文件，名称为接口的全限定名，即包名加类名，内容为实现类的全限定名。例如本例中的文件名称为`cn.ideabuffer.spi.CacheDataSource`，内容如下：

```java
cn.ideabuffer.spi.MemoryCacheDataSource
```

新建一个测试类：

```java
public class Main {
    public static void main(String[] args) {
        ServiceLoader<CacheDataSource> s = ServiceLoader.load(CacheDataSource.class);
        Iterator<CacheDataSource> it = s.iterator();
        for (;it.hasNext();){
            CacheDataSource cacheDataSource = it.next();
            cacheDataSource.getDataSource();
        }
    }
}
```

这里通过ServiceLoader来获取具体的实现类，执行后的输出如下：

```
sun.misc.Launcher$AppClassLoader@2503dbd3
MemoryCacheDataSource
```

我们查看一下ServiceLoader中的load方法：

```java
public static <S> ServiceLoader<S> load(Class<S> service) {
    ClassLoader cl = Thread.currentThread().getContextClassLoader();
    return ServiceLoader.load(service, cl);
}
```

这里使用了Context Class Loader，为什么要这么使用呢，为什么不直接使用系统类加载器呢？接下来我们具体分析一下。

## 线程上下文类加载器

线程上下文类加载器（context class loader）是从JDK 1.2开始引入的。类`java.lang.Thread`中的方法 `getContextClassLoader()` 和 `setContextClassLoader(ClassLoader cl)` 用来获取和设置线程的上下文类加载器。

如果没有通过 `setContextClassLoader(ClassLoader cl)` 方法进行设置的话，线程将继承其父线程的上下文类加载器。Java 应用运行的初始线程的上下文类加载器是系统类加载器。在线程中运行的代码可以通过此类加载器来加载类和资源。

为了加载类，Java还提供了很多服务提供者接口（Service Provider Interface，SPI），允许第三方为这些接口提供实现。那类加载就会存在问题：SPI 的接口是 Java 核心库的一部分，是由引导类加载器来加载的；SPI 实现的 Java 类一般是由系统类加载器来加载的。引导类加载器是无法找到 SPI 的实现类的，因为它只加载 Java 的核心库。在 SPI 接口的代码中使用线程上下文类加载器，就可以成功的加载到 SPI 实现的类。java的双亲委托类加载机制（ClassLoader A -> System class loader -> Extension class loader -> Bootstrap class loader）可以保证核心类的正常安全加载。但是右边的 Bootstrap class loader 所加载的代码需要反过来去找委派链靠左边的 ClassLoader A 去加载东西的时候，就需要委派链左边的 ClassLoader 设置为线程的上下文加载器即可。


## 线程上下文类加载器的应用

查看mysql-connector中的Driver方法如下：

```java
public class Driver extends NonRegisteringDriver implements java.sql.Driver {
    //
    // Register ourselves with the DriverManager
    //
    static {
        try {
            java.sql.DriverManager.registerDriver(new Driver());
        } catch (SQLException E) {
            throw new RuntimeException("Can't register driver!");
        }
    }

    /**
     * Construct a new driver and register it with DriverManager
     * 
     * @throws SQLException
     *             if a database error occurs.
     */
    public Driver() throws SQLException {
        // Required for Class.forName().newInstance()
    }
}
```

mysql-connector中的Driver实现了`java.sql.Driver`接口，那么查看mysql-connector中的`META-INF/services`目录可以看到，有一个名为`java.sql.Driver`的文件，文件的内容为：

```
com.mysql.jdbc.Driver
com.mysql.fabric.jdbc.FabricMySQLDriver
```

下面看一下`java.sql.DriverManager`，在Driver的静态代码块中将Driver注册到了DriverManager中，DriverManager依赖了Driver，但通过断点查看，DriverManager是通过Bootstrap类加载器加载的，所以要加载Driver的实现类必须通过其他的类加载器，那么这时，Context ClassLoader的出现，解决了这一问题，也就是上文说过的ServiceLoader中的load方法。

