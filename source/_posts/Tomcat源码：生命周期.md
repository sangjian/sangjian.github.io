---
title: Tomcat源码：生命周期
date: 2016-12-05 22:44:53
categories: Tomcat源码
tags: Tomcat
---

从前几篇文章可以知道，Tomcat包含很多组件，并且一个组件可以包含多个组件，当Tomcat启动时，只需要启动最上层的组件，那么包含于该组件中的其他组件也会一并启动，关闭也一样。这就是通过实现`org.apache.catalina.Lifecycle`接口来实现的单一启动/关闭的效果。

Tomcat的生命周期主要涉及到4种类型：`Lifecycle`、`LifecycleEvent`、`LifecycleState`和`LifecycleListener`，Tomcat也提供了`LifecycleBase`抽象类来简化生命周期的处理，它实现了`Lifecycle`接口，并提供了钩子函数来扩展各个组件在生命周期中的处理行为。

生命周期的基本类图如下：

{% asset_img "QQ20161206-0@2x.png" %}

<!-- more -->

## Lifecycle接口

Tomcat中的组件可以包含多个其他组件，这些组件的启动和关闭并不需要进行单独的启动和关闭，而是只启动或关闭最上层的组件即可使全部组件都能够启动或关闭，这种单一启动/关闭机制就是通过`Lifecycle`接口来实现的。

```java
public interface Lifecycle {
 
    public static final String BEFORE_INIT_EVENT = "before_init";

    public static final String AFTER_INIT_EVENT = "after_init";

    public static final String START_EVENT = "start";

    public static final String BEFORE_START_EVENT = "before_start";

    public static final String AFTER_START_EVENT = "after_start";

    public static final String STOP_EVENT = "stop";

    public static final String BEFORE_STOP_EVENT = "before_stop";

    public static final String AFTER_STOP_EVENT = "after_stop";

    public static final String AFTER_DESTROY_EVENT = "after_destroy";

    public static final String BEFORE_DESTROY_EVENT = "before_destroy";

    public static final String PERIODIC_EVENT = "periodic";

    public static final String CONFIGURE_START_EVENT = "configure_start";

    public static final String CONFIGURE_STOP_EVENT = "configure_stop";

    public void addLifecycleListener(LifecycleListener listener);

    public LifecycleListener[] findLifecycleListeners();

    public void removeLifecycleListener(LifecycleListener listener);

    public void init() throws LifecycleException;

    public void start() throws LifecycleException;

    public void stop() throws LifecycleException;

    public void destroy() throws LifecycleException;

    public LifecycleState getState();

    public String getStateName();

    public interface SingleUse {
    }
}
```

接口中定义了很多触发事件，常用的例如`before_init `、`after_init `、`before_start`、`start`、`after_start`等等，只看名字也能知道是做什么的了。

`start`和`stop`方法是对组件进行启动和关闭的操作；`addLifecycleListener `、`removeLifecycleListener `和`findLifecycleListeners `都是与事件监听相关的。一个组件可以注册多个事件监听器来监听该组件对应的某些事件，当触发了该事件时，会通知相应的监听器。

这里面还有一个很有意思的内部接口`SingleUse `，它是一个标记接口，用于指示实例应该只使用一次。当一个组件实例实现了这个接口会在`stop`方法完成时自动调用`destroy`方法。例如在`LifecycleBase`中的`stop`方法：

```java
try {
    stopInternal();
} catch (Throwable t) {
    ExceptionUtils.handleThrowable(t);
    setStateInternal(LifecycleState.FAILED, null, false);
    throw new LifecycleException(sm.getString("lifecycleBase.stopFail",toString()), t);
} finally {
    // 如果实现了Lifecycle.SingleUse接口，则设置状态为已关闭，然后调用destroy()方法
    if (this instanceof Lifecycle.SingleUse) {
        // Complete stop process first
        setStateInternal(LifecycleState.STOPPED, null, false);
        destroy();
        return;
    }
}
```

作为一个标记接口，并没有需要实现的方法，仅仅代表了一种能力，例如实现了`java.io.Serializable`接口的实例，表示该实例可以序列化，在判断时会使用`instanceof`关键字来进行判断。
其实在`java.util.Map<K,V>`接口中也定义了一个内部接口`Map.Entry<K, V>`：

```java
public interface Map<K,V> {

    ...
    
    interface Entry<K,V> {
        ...
    }

}
```
那么为什么要定义一个内部接口呢，内部接口的作用是什么？具体现在我也不太清楚，这里先标记一下，有空专门研究一下。

## LifecycleEvent类

`LifecycleEvent`类的实例表示一个生命周期的事件，类的定义如下：

```java
public final class LifecycleEvent extends EventObject {

    private static final long serialVersionUID = 1L;


    /**
     * Construct a new LifecycleEvent with the specified parameters.
     *
     * @param lifecycle Component on which this event occurred
     * @param type Event type (required)
     * @param data Event data (if any)
     */
    public LifecycleEvent(Lifecycle lifecycle, String type, Object data) {
        super(lifecycle);
        this.type = type;
        this.data = data;
    }


    /**
     * The event data associated with this event.
     */
    private final Object data;


    /**
     * The event type this instance represents.
     */
    private final String type;


    /**
     * @return the event data of this event.
     */
    public Object getData() {
        return data;
    }


    /**
     * @return the Lifecycle on which this event occurred.
     */
    public Lifecycle getLifecycle() {
        return (Lifecycle) getSource();
    }


    /**
     * @return the event type of this event.
     */
    public String getType() {
        return this.type;
    }
}

```

在构造方法中，第一个参数为生命周期的组件，第二个参数为事件类型，第三个参数为传入的数据，可以看成是对这三种类型的封装。

另外介绍一下`EventObject`对象，它里面定义了一个事件源对象，所谓事件源就是事件发生的地方，而在Tomcat的设计中，事件源就是实现了`Lifecycle`接口的各个需要管理生命周期的组件。每个组件都继承自`LifecycleBase`，那么组件就是通过`LifecycleBase`来实现事件源的传递，这样在`LifecycleBase`触发事件的时候，可以通过事件源（也就是相当于当前组件*this*）构建`EventObject`.这样以来`LifecycleListener`就可以通过事件对象获取到事件源，从而做一些与事件源相关的操作。如果还是不太清楚的话，继续往下看。

## LifecycleListener接口

一个生命周期的事件监听器是该接口的实例，该接口的定义如下：

```java
public interface LifecycleListener {


    /**
     * Acknowledge the occurrence of the specified event.
     *
     * @param event LifecycleEvent that has occurred
     */
    public void lifecycleEvent(LifecycleEvent event);


}

```

只有一个方法`lifecycleEvent`，看到该方法的参数正是上面所讲到的`LifecycleEvent`，当某个事件监听器监听到相关事件时，会调用该方法。例如，当`Server`组件启动时，看下`StandardServer`中的`startInternal`方法的代码：

```java
@Override
protected void startInternal() throws LifecycleException {
    
    // 该方法继承自LifecycleBase
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
`fireLifecycleEvent`方法继承自`LifecycleBase `：

```java
protected void fireLifecycleEvent(String type, Object data) {
    LifecycleEvent event = new LifecycleEvent(this, type, data);
    for (LifecycleListener listener : lifecycleListeners) {
        listener.lifecycleEvent(event);
    }
}
```

可以看到，在该方法中，创建了一个`LifecycleEvent`对象，并将当前对象（`StandardServer`）作为第一个参数传入`LifecycleEvent`构造器中，然后监听器会调用`lifecycleEvent`方法来执行具体的操作。

## LifecycleBase类

`LifecycleBase`实现了`Lifecycle`接口，添加了几个新的方法如`setStateInternal`(更新组件状态)、`fireLifecycleEvent`(触发LifecycleEvent)，以及一些钩子方法例如`initInternal`、`startInternal`等。

{% asset_img "屏幕快照 2016-12-06 下午10.54.49.png" %}

例如上文中提到的`fireLifecycleEvent`方法，用来触发事件；再例如，执行`init`方法时，会调用抽象方法`initInternal`：

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

具体的规则在子类中实现。

该类中定义了两个重要的变量：`lifecycleListeners`和`state`：

```java
/**
 * The list of registered LifecycleListeners for event notifications.
 */
private final List<LifecycleListener> lifecycleListeners = new CopyOnWriteArrayList<>();


/**
 * The current state of the source component.
 */
private volatile LifecycleState state = LifecycleState.NEW;
```

`lifecycleListeners`用来保存监听器，`state`表示当前生命周期的状态。

### lifecycleListeners属性

首先来看下`lifecycleListeners`，它是`CopyOnWriteArrayList`的类型，这里简单介绍一下：

> Copy-On-Write简称COW，是一种用于程序设计中的优化策略。其基本思路是，从一开始大家都在共享同一个内容，当某个人想要修改这个内容的时候，才会真正把内容Copy出去形成一个新的内容然后再改，这是一种延时懒惰策略。从JDK1.5开始Java并发包里提供了两个使用CopyOnWrite机制实现的并发容器,它们是CopyOnWriteArrayList和CopyOnWriteArraySet。CopyOnWrite容器非常有用，可以在非常多的并发场景中使用到。

CopyOnWrite容器即写时复制的容器。通俗的理解是当我们往一个容器添加元素的时候，不直接往当前容器添加，而是先将当前容器进行Copy，复制出一个新的容器，然后新的容器里添加元素，添加完元素之后，再将原容器的引用指向新的容器。这样做的好处是我们可以对CopyOnWrite容器进行并发的读，而不需要加锁，因为当前容器不会添加任何元素。所以CopyOnWrite容器也是一种读写分离的思想，读和写不同的容器。

那么在`LifecycleBase`中，为什么将`lifecycleListeners`变量定义为这种类型？从上面的分析可知，`CopyOnWriteArrayList`适用于读多写少的情况。回顾一下[Tomcat源码：Catalina启动流程](/2016/11/27/Tomcat源码：Catalina启动流程/)中提到的`createStartDigester`方法，在该方法中有如下代码：

```java
//创建listener，其中第二个参数为空，表示必须在配置文件中指定className
digester.addObjectCreate("Server/Listener",
                         null, // MUST be specified in the element
                         "className");
digester.addSetProperties("Server/Listener");
digester.addSetNext("Server/Listener",
                    "addLifecycleListener",
                    "org.apache.catalina.LifecycleListener");
```

对于服务器组件`Server`，监听器是在调用`StandardServer`的构造方法和解析配置文件`server.xml`时通过调用`addLifecycleListener`方法来添加到`lifecycleListeners`变量中的，那么当Tomcat启动后，就基本不会再添加新的Listener了。但注意，是*基本*不会添加，并不绝对，例如`org.apache.catalina.startup.HostConfig`，它也是一个监听器，看下其中的`reload`方法：

```java
/*
 * Note: If either of fileToRemove and newDocBase are null, both will be
 *       ignored.
 */
private void reload(DeployedApplication app, File fileToRemove, String newDocBase) {
    if(log.isInfoEnabled())
        log.info(sm.getString("hostConfig.reload", app.name));
    Context context = (Context) host.findChild(app.name);
    if (context.getState().isAvailable()) {
        if (fileToRemove != null && newDocBase != null) {
            context.addLifecycleListener(
                    new ExpandedDirectoryRemovalListener(fileToRemove, newDocBase));
        }
        // Reload catches and logs exceptions
        context.reload();
    } else {
        // If the context was not started (for example an error
        // in web.xml) we'll still get to try to start
        if (fileToRemove != null && newDocBase != null) {
            ExpandWar.delete(fileToRemove);
            context.setDocBase(newDocBase);
        }
        try {
            context.start();
        } catch (Exception e) {
            log.warn(sm.getString
                     ("hostConfig.context.restart", app.name), e);
        }
    }
}
```

该方法是重新加载一个context，那么可以看到，这里为`context`增加了一个监听器，该监听器用来确保在重新加载context时，将之前WAR包解压出来的目录删除，并且将dcoBase设置到指定的WAR。

在使用`CopyOnWriteArrayList`时需要注意两个问题：

* 内存占用问题
* 数据一致性问题

*内存占用问题：*因为CopyOnWrite的写时复制机制，所以在进行写操作的时候，内存里会同时驻扎两个对象的内存，如果列表中的对象比较大，假设为100M，那么再写入100M的对象进去，内存就会占用200M，那么这个时候很有可能造成频繁的Yong GC和Full GC，从而会导致整个系统响应时间过长。

*数据一致性问题：*CopyOnWrite容器只能保证数据的最终一致性，不能保证数据的实时一致性。所以如果你希望写入的的数据能够立即读到，那么请不要使用CopyOnWrite容器。


总体来说，一般组件启动之后，就基本不会再添加新的监听器了，所以使用`CopyOnWriteArrayList`类型是很合适的。

### state属性

再来看下`state`属性，该属性被`volatile`关键字修饰，保证了`state`属性的可见性，但也仅仅是可见性，而不具有原子性，所以，它与`synchronized`关键字相比，少了原子性，可以看做是"轻量级的`synchronized`"。

这里为什么用`volatile`关键字修饰？

先考虑一下是否需要原子性。我们现在可以知道，一个组件的状态是在调用生命周期的`init`、`start`等`Lifecycle`接口中定义的生命周期行为的方法时才会被设置，一个组件不可能在同一时间调用不同的生命周期行为，所以原子性是不必要的。

再来考虑一下可见性。当组件的状态改变时，当然是需要立即被读取到，通过组件生命周期的状态来判断是否应该执行指定的生命周期的行为，例如一个组件已经执行了`destroy`方法，那么就不可能再调用该组件的`start`方法，所以可见性是必须的。

## LifecycleState类

`LifecycleState`是一个枚举类型，定义如下：

```java
/**
 * The list of valid states for components that implement {@link Lifecycle}.
 * See {@link Lifecycle} for the state transition diagram.
 */
public enum LifecycleState {
    NEW(false, null),
    INITIALIZING(false, Lifecycle.BEFORE_INIT_EVENT),
    INITIALIZED(false, Lifecycle.AFTER_INIT_EVENT),
    STARTING_PREP(false, Lifecycle.BEFORE_START_EVENT),
    STARTING(true, Lifecycle.START_EVENT),
    STARTED(true, Lifecycle.AFTER_START_EVENT),
    STOPPING_PREP(true, Lifecycle.BEFORE_STOP_EVENT),
    STOPPING(false, Lifecycle.STOP_EVENT),
    STOPPED(false, Lifecycle.AFTER_STOP_EVENT),
    DESTROYING(false, Lifecycle.BEFORE_DESTROY_EVENT),
    DESTROYED(false, Lifecycle.AFTER_DESTROY_EVENT),
    FAILED(false, null);

    private final boolean available;
    private final String lifecycleEvent;

    private LifecycleState(boolean available, String lifecycleEvent) {
        this.available = available;
        this.lifecycleEvent = lifecycleEvent;
    }

    /**
     * May the public methods other than property getters/setters and lifecycle
     * methods be called for a component in this state? It returns
     * <code>true</code> for any component in any of the following states:
     * <ul>
     * <li>{@link #STARTING}</li>
     * <li>{@link #STARTED}</li>
     * <li>{@link #STOPPING_PREP}</li>
     * </ul>
     *
     * @return <code>true</code> if the component is available for use,
     *         otherwise <code>false</code>
     */
    public boolean isAvailable() {
        return available;
    }

    public String getLifecycleEvent() {
        return lifecycleEvent;
    }
}
```

`LifecycleState`包含两个属性：`available`和`lifecycleEvent`。

* available：判断在当前状态下是否可以调用除getter/setter方法以外的public方法以及生命周期中的方法。当前状态为以下状态时返回`true`:
  * STARTING
  * STARTED
  * STOPPING_PREP

* getLifecycleEvent：获取处于此状态的组件正在进行的事件

例如，在`StandardServer`中的`addService`方法中：

```java
@Override
public void addService(Service service) {

    service.setServer(this);

    synchronized (servicesLock) {
        Service results[] = new Service[services.length + 1];
        System.arraycopy(services, 0, results, 0, services.length);
        results[services.length] = service;
        services = results;

        if (getState().isAvailable()) {
            try {
                service.start();
            } catch (LifecycleException e) {
                // Ignore
            }
        }

        // Report this property change to interested listeners
        support.firePropertyChange("service", null, service);
    }

}
```

如果当前Server正在启动或者已经启动，就可以直接启动服务组件`service`。

## 总结

以上就是Tomcat生命周期的核心内容，了解了生命周期，就可以很清楚的明白Tomcat的启动流程，通过Lifecycle，Tomcat只需启动最顶层组件`Server`，即可启动所有的组件，关闭也是类似，这就是单一启动/关闭机制。

通过对源码的阅读，不仅需要知道代码是怎么设计的，还需要知道代码为什么这样设计，例如本文中提到的`LifecycleBase`中的两个属性：`lifecycleListeners`和`state`，`lifecycleListeners`为什么要定义为`CopyOnWriteArrayList`类型？`state`为什么要用`volatile`关键字修饰？结合它们的使用，便可以知道它们的使用场景，可以更加透彻的分析出整个流程执行的机制，从而也会收获的更多。
最后，希望对大家有所帮助。