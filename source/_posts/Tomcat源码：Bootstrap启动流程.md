---
title: Tomcat源码：Bootstrap启动流程
date: 2016-11-26 19:19:13
categories: Tomcat源码
tags: Tomcat
---

Tomcat的启动流程从整体上来说并不算复杂，启动的入口就是从Bootstrap类的main方法开始的，这篇文章就让我们来看一下Bootstrap这个类都干了些什么。

## Bootstrap类中的变量

首先看下Bootstrap都定义了哪些变量

```java
// Bootstrap类的引用
private static Bootstrap daemon = null;

// 这两个路径一般都是tomcat的根目录，即webapp的父目录
private static final File catalinaBaseFile;
private static final File catalinaHomeFile;

private static final Pattern PATH_PATTERN = Pattern.compile("(\".*?\")|(([^,])*)");

// 这个其实就是`org.apache.catalina.startup.Catalina`对象，它是真正负责启动server的对象
private Object catalinaDaemon = null;

// tomcat涉及到的类加载器
ClassLoader commonLoader = null;
ClassLoader catalinaLoader = null;
ClassLoader sharedLoader = null;
```

<!-- more -->

## Tomcat的类加载器

首先看下JVM的类加载器的结构：

{% asset_img "jvm-class-loader.png" %}

* Bootstrap：引导类加载器，负责加载`rt.jar`
* Extension：扩展类加载器，负责加载`jre/lib/ext`中的jar
* System：系统类加载器，负责加载指定classpath中的jar

下面来看一下tomcat的类加载器的结构：

{% asset_img "tomcat-class-loader.png" %}

* Bootstrap：负责加载JVM启动时所需要的类以及`$JAVA_HOME/jre/lib/ext`目录中的类。相当于Java类加载器的Bootstrap和Extension。
* System：负责加载`$CATALINA_HOME/bin`目录下的类，比如`bootstrap.jar`
* Common：负责加载tomcat使用以及应用通用的一些类，位于`$CATALINA_HOME/lib`或`$CATALINA_BASE/lib`下的jar，比如`servlet-api.jar`
* WebappX：每个应用在部署后，都会创建一个唯一的类加载器。该类加载器会加载位于该应用下的`WEB-INF/lib`中的jar文件和`WEB-INF/classes`中的class文件

在tomcat中，如果要加载一个类，那么他的加载顺序为：

1. 使用bootstrap引导类加载器加载

2. 使用system系统类加载器加载

3. 使用应用类加载器在`WEB-INF/classes`中加载

4. 使用应用类加载器在`WEB-INF/lib`中加载

5. 使用common类加载器在`$CATALINA_HOME/lib`或`$CATALINA_BASE/lib`中加载


参考：[tomcat-8.5-doc](http://tomcat.apache.org/tomcat-8.5-doc/class-loader-howto.html)

## static代码块

在static代码块中，主要是对一些路径进行初始化。代码如下：

```java
static {
    //当前tomcat的路径，其实就是tomcat所在的目录的路径
    // Will always be non-null
    String userDir = System.getProperty("user.dir");
    
    // 该路径是设置的catalina.home指定的路径
    // Home first
    String home = System.getProperty(Globals.CATALINA_HOME_PROP);
    File homeFile = null;

    if (home != null) {
        File f = new File(home);
        try {
            homeFile = f.getCanonicalFile();
        } catch (IOException ioe) {
            homeFile = f.getAbsoluteFile();
        }
    }

    if (homeFile == null) {
        // First fall-back. See if current directory is a bin directory
        // in a normal Tomcat install
        File bootstrapJar = new File(userDir, "bootstrap.jar");

        if (bootstrapJar.exists()) {
            File f = new File(userDir, "..");
            try {
                homeFile = f.getCanonicalFile();
            } catch (IOException ioe) {
                homeFile = f.getAbsoluteFile();
            }
        }
    }

    if (homeFile == null) {
        // Second fall-back. Use current directory
        File f = new File(userDir);
        try {
            homeFile = f.getCanonicalFile();
        } catch (IOException ioe) {
            homeFile = f.getAbsoluteFile();
        }
    }

    catalinaHomeFile = homeFile;
    System.setProperty(
            Globals.CATALINA_HOME_PROP, catalinaHomeFile.getPath());

    // Then base
    String base = System.getProperty(Globals.CATALINA_BASE_PROP);
    
    // 可见，如果没有设置base路径，默认就是catalina.home指定的路径
    if (base == null) {
        catalinaBaseFile = catalinaHomeFile;
    } else {
        File baseFile = new File(base);
        try {
            baseFile = baseFile.getCanonicalFile();
        } catch (IOException ioe) {
            baseFile = baseFile.getAbsoluteFile();
        }
        catalinaBaseFile = baseFile;
    }
    System.setProperty(
            Globals.CATALINA_BASE_PROP, catalinaBaseFile.getPath());
}
```

以上可见，主要是设置了一些运行时所需要的路径，例如要设置catalina.home，如果你要运行tomcat源码的话，可以在启动选项的VM options中设置`-Dcatalina.home="/Users/sangjian/dev/source-files/apache-tomcat-8.5.4-src/output/build"`来指定。例如：

{% asset_img "B2439EFA-6276-425A-A807-C66B975E59F6.png" %}


## main方法

```java
/**
 * Main method and entry point when starting Tomcat via the provided
 * scripts.
 *
 * @param args Command line arguments to be processed
 */
public static void main(String args[]) {

    if (daemon == null) {
        //创建Bootstarp类型的对象  
        // Don't set daemon until init() has completed
        Bootstrap bootstrap = new Bootstrap();
        try {
            bootstrap.init();
        } catch (Throwable t) {
            handleThrowable(t);
            t.printStackTrace();
            return;
        }
        daemon = bootstrap;
    } else {
        // When running as a service the call to stop will be on a new
        // thread so make sure the correct class loader is used to prevent
        // a range of class not found exceptions.
        Thread.currentThread().setContextClassLoader(daemon.catalinaLoader);
    }

    try {
        String command = "start";
        if (args.length > 0) {
            command = args[args.length - 1];
        }

        if (command.equals("startd")) {
            args[args.length - 1] = "start";
            daemon.load(args);
            daemon.start();
        } else if (command.equals("stopd")) {
            args[args.length - 1] = "stop";
            daemon.stop();
        } else if (command.equals("start")) {
            daemon.setAwait(true);
            daemon.load(args);
            daemon.start();
        } else if (command.equals("stop")) {
            daemon.stopServer(args);
        } else if (command.equals("configtest")) {
            daemon.load(args);
            if (null==daemon.getServer()) {
                System.exit(1);
            }
            System.exit(0);
        } else {
            log.warn("Bootstrap: command \"" + command + "\" does not exist.");
        }
    } catch (Throwable t) {
        // Unwrap the Exception for clearer error reporting
        if (t instanceof InvocationTargetException &&
                t.getCause() != null) {
            t = t.getCause();
        }
        handleThrowable(t);
        t.printStackTrace();
        System.exit(1);
    }

}
```

其实整个流程很简单，总结如下：

1. 创建一个自身对象并调用`init`方法初始化，赋值给daemon
2. 判断参数，默认是start
3. 执行`daemon.load`方法，判断参数类型，反射调用`org.apache.catalina.startup.Catalina`对象的`load`方法
4. 执行`daemon.start`方法，反射调用`org.apache.catalina.startup.Catalina`对象的`start`方法

## init方法

```java
/**
 * Initialize daemon.
 * @throws Exception Fatal initialization error
 */
public void init() throws Exception {
    
    // 初始化类加载器
    initClassLoaders();

    // 设置当前线程的类加载器
    Thread.currentThread().setContextClassLoader(catalinaLoader);

    SecurityClassLoad.securityClassLoad(catalinaLoader);

    // Load our startup class and call its process() method
    if (log.isDebugEnabled())
        log.debug("Loading startup class");
    Class<?> startupClass =
        catalinaLoader.loadClass
        ("org.apache.catalina.startup.Catalina");
    Object startupInstance = startupClass.newInstance();

    // Set the shared extensions class loader
    if (log.isDebugEnabled())
        log.debug("Setting startup class properties");
    String methodName = "setParentClassLoader";
    Class<?> paramTypes[] = new Class[1];
    paramTypes[0] = Class.forName("java.lang.ClassLoader");
    Object paramValues[] = new Object[1];
    
    /* 
     * sharedLoader为加载$CATALINA_HOME/lib目录的类加载器
     * 其实在Tomcat5之后，并取消了catalinaLoader和sharedLoader，而默认只设置了commonLoader
     * 在默认配置的情况下，这里使用sharedLoader的来加载class时，还是会通过commonLoader来加载
     * 因为sharedLoader的parentClassLoader是catalinaLoader，catalinaLoder的parentClassLoader是commonLoader
     * 但在这里，这3个加载器都是commonLoader这个对象，这个稍后会说到
     */
    paramValues[0] = sharedLoader;
    Method method =
        startupInstance.getClass().getMethod(methodName, paramTypes);
    
    // 设置org.apache.catalina.startup.Catalina对象的parentClassloader
    method.invoke(startupInstance, paramValues);

    catalinaDaemon = startupInstance;

}
```

init方法主要做了以下几件事：

1. 初始化类加载器
2. 设置当前线程的类加载器
3. 创建`org.apache.catalina.startup.Catalina`对象`startupInstance`
4. 反射调用`org.apache.catalina.startup.Catalina`对象的`setParentClassLoader`方法，设置父加载器为`sharedLoader`
5. 将`startupInstance`赋值给`catalinaDaemon`

## initClassLoaders和createClassLoader方法

```java
private void initClassLoaders() {
    try {
        commonLoader = createClassLoader("common", null);
        if( commonLoader == null ) {
            // no config file, default to this loader - we might be in a 'single' env.
            commonLoader=this.getClass().getClassLoader();
        }
        catalinaLoader = createClassLoader("server", commonLoader);
        sharedLoader = createClassLoader("shared", commonLoader);
    } catch (Throwable t) {
        handleThrowable(t);
        log.error("Class loader creation threw exception", t);
        System.exit(1);
    }
}


private ClassLoader createClassLoader(String name, ClassLoader parent)
    throws Exception {

    String value = CatalinaProperties.getProperty(name + ".loader");
    
    // 如果catalina.properties文件中没有值，则返回parent
    if ((value == null) || (value.equals("")))
        return parent;

    value = replace(value);

    List<Repository> repositories = new ArrayList<>();

    String[] repositoryPaths = getPaths(value);

    for (String repository : repositoryPaths) {
        // Check for a JAR URL repository
        try {
            @SuppressWarnings("unused")
            URL url = new URL(repository);
            repositories.add(
                    new Repository(repository, RepositoryType.URL));
            continue;
        } catch (MalformedURLException e) {
            // Ignore
        }

        // Local repository
        if (repository.endsWith("*.jar")) {
            repository = repository.substring
                (0, repository.length() - "*.jar".length());
            repositories.add(
                    new Repository(repository, RepositoryType.GLOB));
        } else if (repository.endsWith(".jar")) {
            repositories.add(
                    new Repository(repository, RepositoryType.JAR));
        } else {
            repositories.add(
                    new Repository(repository, RepositoryType.DIR));
        }
    }

    return ClassLoaderFactory.createClassLoader(repositories, parent);
}
```

基于之前介绍的tomcat的类加载器，这两个方法应该比较好理解了，这里需要注意的是，在Tomcat5之后，Tomcat的类加载器发生了变化，默认是没有catalinaLoader和sharedLoader的路径了，这个可以通过查看`catalina.properties`文件来说明：

```
common.loader="${catalina.base}/lib","${catalina.base}/lib/*.jar","${catalina.home}/lib","${catalina.home}/lib/*.jar"

server.loader=

shared.loader=
```

可见，默认只设置了commonLoader。从`createClassLoader`方法可以看出，后两个loader的值是空的，所以commonLoader,catalinaLoader和sharedLoader都是同一个对象。

## load方法

```java
/**
 * Load daemon.
 */
private void load(String[] arguments)
    throws Exception {

    // Call the load() method
    String methodName = "load";
    Object param[];
    Class<?> paramTypes[];
    if (arguments==null || arguments.length==0) {
        paramTypes = null;
        param = null;
    } else {
        paramTypes = new Class[1];
        paramTypes[0] = arguments.getClass();
        param = new Object[1];
        param[0] = arguments;
    }
    Method method =
        catalinaDaemon.getClass().getMethod(methodName, paramTypes);
    if (log.isDebugEnabled())
        log.debug("Calling startup class " + method);
    method.invoke(catalinaDaemon, param);

}
```

这不用多说了吧，还是调用`org.apache.catalina.startup.Catalina`对象的`load`方法。

## start方法

```java
/**
 * Start the Catalina daemon.
 * @throws Exception Fatal start error
 */
public void start()
    throws Exception {
    if( catalinaDaemon==null ) init();

    Method method = catalinaDaemon.getClass().getMethod("start", (Class [] )null);
    method.invoke(catalinaDaemon, (Object [])null);

}
```

更简单是不是？

以上就是Bootstrap类的工作，接下来就是Catalina需要做的事了，所以从这个流程来看，Bootstrap所做的工作还是很简单的。关于Catalina的分析下一篇文章继续吧。