---
title: Tomcat源码：类加载器
date: 2016-12-24 16:12:01
categories: Tomcat源码
tags: Tomcat
---
在[Tomcat源码：Bootstrap启动流程](/2016/11/26/Tomcat源码：Bootstrap启动流程/)文章中简单介绍过Java类加载器和Tomcat的类加载器，可以知道，每一个应用都有一个单独的类加载器来加载位于该应用下的WEB-INF/lib中的jar文件和WEB-INF/classes中的class文件，该应用不可以访问其他路径的class或jar。

Tomcat中实现自定义加载器还有另一个原因，就是为了提供自动重载的功能，如果当WEB-INF/classes目录或WEB-INF/lib目录中的类发生变化时，Web应用会重新加载这些类。

下面来看一下Tomcat中类加载器的类图：

{% asset_img "QQ20161224-0@2x.png" %}

<!-- more -->

## Loader接口

要实现Tomcat的类载入器必须遵守一些规则，例如，Web应用程序必须只能使用WEB-INF/classes目录或WEB-INF/lib目录中的类，不能访问其他路径中的类，即使这些类已经包含在当前Tomcat的JVM的CLASSPATH环境变量中。

Web应用程序的类加载器必须实现`org.apache.catalina.Loader`接口，其有一个实现类是`org.apache.catalina.loader.WebappLoader`，下面来看一下Loader接口的定义：

```java
public interface Loader {

    public void backgroundProcess();
    
    public ClassLoader getClassLoader();

    public Context getContext();

    public void setContext(Context context);

    public boolean getDelegate();

    public void setDelegate(boolean delegate);

    public boolean getReloadable();

    public void setReloadable(boolean reloadable);

    public void addPropertyChangeListener(PropertyChangeListener listener);

    public boolean modified();

    public void removePropertyChangeListener(PropertyChangeListener listener);
}
```

`org.apache.catalina.loader.WebappLoader`类作为Loader接口的实现，它的实例使用了`org.apache.catalina.loader.WebappClassLoader`作为其类加载器。

## WebappLoader类

WebappLoader类同样实现了`org.apache.catalina.LifeCycle`接口，可以通过与其相关联的容器来启动或关闭，下面看一下用于WebappLoader启动的startInternal方法代码：

```java
@Override
protected void startInternal() throws LifecycleException {

    if (log.isDebugEnabled())
        log.debug(sm.getString("webappLoader.starting"));

    if (context.getResources() == null) {
        log.info("No resources for " + context);
        setState(LifecycleState.STARTING);
        return;
    }

    // Construct a class loader based on our current repositories list
    try {
        
        // 创建类载入器，是WebappClassLoaderBase类的实例
        classLoader = createClassLoader();
        // 设置用来描述当前Web应用的资源信息的实例，是WebResourceRoot类型
        // 对于Context来说，是StandardRoot类的实例
        classLoader.setResources(context.getResources());
        classLoader.setDelegate(this.delegate);

        // 设置类路径
        // Configure our repositories
        setClassPath();
        
        // 设置访问权限
        setPermissions();

        // 启动WebappClassLoader
        ((Lifecycle) classLoader).start();

        String contextName = context.getName();
        if (!contextName.startsWith("/")) {
            contextName = "/" + contextName;
        }
        ObjectName cloname = new ObjectName(context.getDomain() + ":type=" +
                classLoader.getClass().getSimpleName() + ",host=" +
                context.getParent().getName() + ",context=" + contextName);
        Registry.getRegistry(null, null)
            .registerComponent(classLoader, cloname, null);

    } catch (Throwable t) {
        t = ExceptionUtils.unwrapInvocationTargetException(t);
        ExceptionUtils.handleThrowable(t);
        log.error( "LifecycleException ", t );
        throw new LifecycleException("start: ", t);
    }

    setState(LifecycleState.STARTING);
}
```

在startInternal方法中，主要做了以下几种工作：

1. 创建类加载器
2. 设置类加载器的WebResourceRoot
3. 设置类路径
4. 设置访问权限
5. 启动WebappClassLoader

### 创建类加载器

在前面介绍的Loader接口中，可以看到声明了`getClassLoader()`方法，但其中并没有声明`setClassLoader()`方法，是不是就只能使用默认的类加载器呢？

可以看到，在WebappLoader类中有一个属性是`loaderClass`，该属性的定义如下：

```java
private String loaderClass = ParallelWebappClassLoader.class.getName();
```

它是String类型，默认是`ParallelWebappClassLoader`类的全限定名，同时有一个`setLoaderClass`方法用来设置该属性：

```java
public void setLoaderClass(String loaderClass) {
    this.loaderClass = loaderClass;
}
```

可见，默认情况下`loaderClass`的值是`org.apache.catalina.loader.ParallelWebappClassLoader`，可以通过继承`WebappClassLoaderBase`类的方式来实现自己的类加载器，同时调用`setLoaderClass`方法来使用自己的类加载器。下面看一下`createClassLoader`方法的代码：

```java
private WebappClassLoaderBase createClassLoader()
        throws Exception {

    // 加载loaderClass
    Class<?> clazz = Class.forName(loaderClass);
    WebappClassLoaderBase classLoader = null;

    // 设置父加载器
    if (parentClassLoader == null) {
        parentClassLoader = context.getParentClassLoader();
    }
    Class<?>[] argTypes = { ClassLoader.class };
    Object[] args = { parentClassLoader };
    Constructor<?> constr = clazz.getConstructor(argTypes);
    // 实例化类加载器
    classLoader = (WebappClassLoaderBase) constr.newInstance(args);

    return classLoader;
}
```

可见该方法返回的类型是`WebappClassLoaderBase`类型，所以如果要自定义类加载器的话要继承该类。


### 设置类路径
通过调用`setClassPath`方法来设置类路径，这里会遍历调用classLoader以及其父加载器的repositories，并保存到`classpath`变量中，这里先不过多介绍了。

### 设置访问权限

若使用了安全管理器，则`setPermissions`方法会为类加载器设置相关的目录访问权限，例如只能访问WEB-INF/classes和WEB-INF/lib目录，若没有使用安全管理器，则该方法并不做任何处理。

## WebappClassLoaderBase类

该类的实例是具体负责类的载入工作的。它继承自`java.net.URLClassLoader`类。该类在载入的时候做了优化的方案，它会先缓存已经载入的类用来提升性能，同时，还会缓存载入失败的类，如果再次加载同一个类时，会从缓存中找，如果存在则直接抛出ClassNotFoundException异常，不会再尝试加载该类了。

下面看一下该类中几个重要的方法。

首先看下loadClass方法，这里对代码做了简化，只保留了最核心的功能：

```java
@Override
public Class<?> loadClass(String name, boolean resolve) throws ClassNotFoundException {

    synchronized (getClassLoadingLock(name)) {
        
        Class<?> clazz = null;
        
        // 1. 先从缓存中查找，有则返回
        // (0) Check our previously loaded local class cache
        clazz = findLoadedClass0(name);
        if (clazz != null) {
            if (resolve)
                resolveClass(clazz);
            return (clazz);
        }
        
        // 2. 从parent中查找
        // (0.1) Check our previously loaded class cache
        clazz = findLoadedClass(name);
        if (clazz != null) {
            if (resolve)
                resolveClass(clazz);
            return (clazz);
        }
        
        // 获取扩展类加载器
        ClassLoader javaseLoader = getJavaseClassLoader();
        boolean tryLoadingFromJavaseLoader;
        try {            
            tryLoadingFromJavaseLoader = (javaseLoader.getResource(resourceName) != null);
        } catch (ClassCircularityError cce) {            
            tryLoadingFromJavaseLoader = true;
        }

        if (tryLoadingFromJavaseLoader) {
            try {
                // 3. 从扩展类加载器中查找
                clazz = javaseLoader.loadClass(name);
                if (clazz != null) {
                    if (resolve)
                        resolveClass(clazz);
                    return (clazz);
                }
            } catch (ClassNotFoundException e) {
                // Ignore
            }
        }
        
        // 判断是否让parent代理
        boolean delegateLoad = delegate || filter(name, true);

        // 4. 如果为true，则先从parent中加载
        // (1) Delegate to our parent if requested
        if (delegateLoad) {
            try {
                clazz = Class.forName(name, false, parent);
                if (clazz != null) {
                    if (resolve)
                        resolveClass(clazz);
                    return (clazz);
                }
            } catch (ClassNotFoundException e) {
                // Ignore
            }
        }
        
        // 5. 从该classLoader中的库加载，如果加载成功则写入缓存中
        // (2) Search local repositories
        try {
            clazz = findClass(name);
            if (clazz != null) {               
                if (resolve)
                    resolveClass(clazz);
                return (clazz);
            }
        } catch (ClassNotFoundException e) {
            // Ignore
        }

        // 6. 以上都加载失败，则通过parent代理加载
        // (3) Delegate to parent unconditionally
        if (!delegateLoad) {            
            try {
                clazz = Class.forName(name, false, parent);
                if (clazz != null) {
                    if (resolve)
                        resolveClass(clazz);
                    return (clazz);
                }
            } catch (ClassNotFoundException e) {
                // Ignore
            }
        }
    }

    throw new ClassNotFoundException(name);
}
```

从代码中可以看到，在载入类时，会执行一下步骤：

1. 因为已经载入的类会缓存起来，所以先从缓存中查找；
2. 若缓存中没有，则检查parent的缓存，即调用`java.lang.ClassLoader`类中的findLoadedClass()方法；
3. 若以上两步都没有找到，则使用扩展类加载器进行加载，防止Web应用程序中的类覆盖JavaSE中的类；
4. 判断是否需要代理加载，判断依据是若`delegate`或`filter(name)`为true，则让parent来加载；
5. 从当前classLoader中的库加载，如果加载成功则写入缓存中；
6. 以上都加载失败，若delegateLoad为`false`，则通过parent代理加载（因为为`true`时已经执行过了，所以不用考虑）；
7. 若仍然未找到类，则抛出`ClassNotFoundException`。

其中的`filter`方法用来判断要加载的类是否需要被过滤，有一些特殊的包以及子包下的类是不允许被载入进来的，具体可以参考代码。

下面看一下`findLoadedClass0`方法的代码：

```java
protected Class<?> findLoadedClass0(String name) {

    String path = binaryNameToPath(name, true);

    ResourceEntry entry = resourceEntries.get(path);
    if (entry != null) {
        return entry.loadedClass;
    }
    return null;
}
```

该方法从缓存中查找名字为name的类，`resourceEntries`是一个`ConcurrentHashMap`类型的实例，它保存了加载成功的类，每一个类的信息会封装成一个`ResourceEntry`的实例，该类的定义如下：

```java
public class ResourceEntry {

    /**
     * The "last modified" time of the origin file at the time this resource
     * was loaded, in milliseconds since the epoch.
     */
    public long lastModified = -1;


    /**
     * Loaded class.
     */
    public volatile Class<?> loadedClass = null;
}
```

loadClass会调用findClass方法，下面是findClass的精简过后的代码，去掉了securityManager和log：

```java
 @Override
public Class<?> findClass(String name) throws ClassNotFoundException {

    Class<?> clazz = null;
    try {
        try {
            // 尝试从本地库加载
            clazz = findClassInternal(name);
        } catch(AccessControlException ace) {
            throw new ClassNotFoundException(name, ace);
        } catch (RuntimeException e) {
            throw e;
        }
        // 如果没有找到并且存在外部的库，则请求parent加载
        if ((clazz == null) && hasExternalRepositories) {
            try {
                clazz = super.findClass(name);
            } catch(AccessControlException ace) {
                throw new ClassNotFoundException(name, ace);
            } catch (RuntimeException e) {
                throw e;
            }
        }
        if (clazz == null) {
            throw new ClassNotFoundException(name);
        }
    } catch (ClassNotFoundException e) {
        throw e;
    }
    return (clazz);
}
```

这里调用了`findClassInternal`方法，看下这个方法精简后的代码：

```java
protected Class<?> findClassInternal(String name) {

    if (name == null) {
        return null;
    }
    String path = binaryNameToPath(name, true);

    ResourceEntry entry = resourceEntries.get(path);
    WebResource resource = null;

    if (entry == null) {
        resource = resources.getClassLoaderResource(path);
        
        // 对应的class不存在，返回null
        if (!resource.exists()) {
            return null;
        }

        entry = new ResourceEntry();
        entry.lastModified = resource.getLastModified();
        
        // 把entry添加到本地库中
        // resourceEntries虽然是ConcurrentHashMap类型
        // 但这里为了保证添加后的entry是同一个对象，所以做了同步
        // Add the entry in the local resource repository
        synchronized (resourceEntries) {
            // Ensures that all the threads which may be in a race to load
            // a particular class all end up with the same ResourceEntry
            // instance
            ResourceEntry entry2 = resourceEntries.get(path);
            if (entry2 == null) {
                resourceEntries.put(path, entry);
            } else {
                entry = entry2;
            }
        }
    }
    
    // entry.loadedClass不为空，表示已经加载过了，直接返回
    Class<?> clazz = entry.loadedClass;
    if (clazz != null)
        return clazz;

    synchronized (getClassLoadingLock(name)) {
        clazz = entry.loadedClass;
        if (clazz != null)
            return clazz;

        if (resource == null) {
            resource = resources.getClassLoaderResource(path);
        }
        
        // 对应的class不存在，返回null
        if (!resource.exists()) {
            return null;
        }

        byte[] binaryContent = resource.getContent();
        Manifest manifest = resource.getManifest();
        URL codeBase = resource.getCodeBase();
        Certificate[] certificates = resource.getCertificates();

        if (transformers.size() > 0) {
            // If the resource is a class just being loaded, decorate it
            // with any attached transformers
            String className = name.endsWith(CLASS_FILE_SUFFIX) ?
                    name.substring(0, name.length() - CLASS_FILE_SUFFIX.length()) : name;
            String internalName = className.replace(".", "/");

            for (ClassFileTransformer transformer : this.transformers) {
                try {
                    byte[] transformed = transformer.transform(
                            this, internalName, null, null, binaryContent);
                    if (transformed != null) {
                        binaryContent = transformed;
                    }
                } catch (IllegalClassFormatException e) {
                    log.error(sm.getString("webappClassLoader.transformError", name), e);
                    return null;
                }
            }
        }

        // Looking up the package
        String packageName = null;
        int pos = name.lastIndexOf('.');
        if (pos != -1)
            packageName = name.substring(0, pos);

        Package pkg = null;

        if (packageName != null) {
            pkg = getPackage(packageName);
            // Define the package (if null)
            if (pkg == null) {
                try {
                    if (manifest == null) {
                        definePackage(packageName, null, null, null, null, null, null, null);
                    } else {
                        definePackage(packageName, manifest, codeBase);
                    }
                } catch (IllegalArgumentException e) {
                    
                }
                pkg = getPackage(packageName);
            }
        }

        try {
            clazz = defineClass(name, binaryContent, 0,
                    binaryContent.length, new CodeSource(codeBase, certificates));
        } catch (UnsupportedClassVersionError ucve) {
            throw new UnsupportedClassVersionError(
                    ucve.getLocalizedMessage() + " " +
                    sm.getString("webappClassLoader.wrongVersion",
                            name));
        }
        entry.loadedClass = clazz;
    }

    return clazz;
}
```

逻辑还是比较简单的：

1. 从缓存中查找，若没有找到执行第2步，找到执行第4步；
2. 判断class是否存在，不存在返回null，否则执行第3步；
3. 创建一个entry，添加到resourceEntries中；
4. 判断entry.loadedClass是否为空，为空返回null；
5. 判断class是否存在，不存在返回null；
6. 调用defineClass方法加载；
7. 设置entry.loadedClass。

本文中介绍了Tomcat类加载器有关的类和方法的介绍，下篇文章会介绍一下具体的使用过程以及Tomcat是如何加载每个Web应用中的类。