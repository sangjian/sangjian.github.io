---
title: JMX：Notification
date: 2016-12-18 14:52:56
categories: 开发手册
tags: 
- JMX
- Java
---

## Notification介绍

从前两篇文章可以知道，MBean提供的管理接口允许代理对其管理资源进行控制和配置。然而，对管理复杂的分布式系统来说，这些接口只是提供了一部分功能。一般来说，管理应用程序需要对管理的资源进行监控，以便发生一些行为或者状态变化时能够作出相应的反映。

Notification起到了MBean之间的沟通桥梁的作用。JMX Notification模型和Java Event模型类似，将一些重要的信息，状态的转变，数据的变更传递给Notification Listener，以便资源的管理。

JMX的Notification由四部分组成：

* Notification，一个通用的事件类型，该类标识事件的类型，可以被直接使用，也可以根据传递的事件的需要而被扩展。
* NotificationListener，接收通知的对象需实现此接口。
* NotificationFilter，作为通知过滤器的对象需实现此接口，为通知监听者提供了一个过滤通知的过滤器。
* NotificationBroadcaster，通知发送者需实现此接口，该接口允许希望得到通知的监听者注册。

<!-- more -->

## Notification实例

下面写一个具体的例子来演示一下Notification的使用。

假设Jack要与Rose打招呼，Jack会先开口，说"Hello Rose!"，而Rose会听到，下面看一下Jack的MBean：

```java
public interface JackMBean {

    public void sayHello();
}
```

只有一个`sayHello`方法，看一下它的实现类：

```java
public class Jack extends NotificationBroadcasterSupport implements JackMBean {

    @Override
    public void sayHello() {
        System.out.println("Jack said : Hello Rose!");
        Notification notification = new Notification(
                "jack",  // 类型
                this, // 发送通知的源
                1, // 序号
                System.currentTimeMillis(), // 时间戳
                "Hello Rose!" // 消息内容
        );
        super.sendNotification(notification);
    }
}
```

Jack在打完招呼后创建了一个`Notification`对象用来传递一个通知。

```java
public interface RoseMBean {
    public void heard( String message);
}
```

Rose的MBean只有一个`heard`方法来显示听到的内容，实现类如下：

```java
public class Rose implements RoseMBean {
    @Override
    public void heard(String message) {
        System.out.println("Rose heard : " + message);

    }
}
```

非常简单，下面创建一个`NotificationListener`，作用是在接收到`sayHello`方法中传递的通知后应该做什么：

```java
public class JackListener implements NotificationListener {
    @Override
    public void handleNotification(Notification notification, Object handback) {
        System.out.println("Type=" + notification.getType());
        System.out.println("Source=" + notification.getSource());
        System.out.println("Seq=" + notification.getSequenceNumber());
        System.out.println("send time=" + notification.getTimeStamp());
        System.out.println("message=" + notification.getMessage());

        if (handback != null) {
            if (handback instanceof Rose) {
                Rose rose = (Rose) handback;
                rose.heard(notification.getMessage());
            }
        }
    }
}
```

`handleNotification`方法先打印了通知的信息，然后调用rose的`heard`方法。将各个MBean注册到`MBeanServer`中：

```java
public class HelloAgent {

    public static void main(String[] args) throws MalformedObjectNameException, NotCompliantMBeanException, InstanceAlreadyExistsException, MBeanRegistrationException {
        MBeanServer mBeanServer = ManagementFactory.getPlatformMBeanServer();
        ObjectName jackName = new ObjectName("TestMBean:name=Jack");
        Jack jack = new Jack();
        mBeanServer.registerMBean(jack, jackName);

        ObjectName adapterName = new ObjectName("TestMBean:name=htmladapter,port=9999");
        HtmlAdaptorServer adapter = new HtmlAdaptorServer();
        adapter.setPort(9999);
        mBeanServer.registerMBean(adapter,adapterName);

        Rose rose = new Rose();
        ObjectName roseName = new ObjectName("TestMBean:name=Rose");
        mBeanServer.registerMBean(rose, roseName);


        jack.addNotificationListener(new JackListener(), null, rose);

        adapter.start();
    }

}
```

运行后，在浏览器中输入http://localhost:9999，查看：

{% asset_img "QQ20161218-0.png" %}

点击`name=Java`

{% asset_img "QQ20161218-1.png" %}

再点击`sayHello`按钮，查看控制台，会输出：

```
Jack said : Hello Rose!
Type=jack
Source=cn.ideabuffer.jmx.notification.Jack@3a43df66
Seq=1
send time=1482050137393
message=Hello Rose!
Rose heard : Hello Rose!
```

## Notification的实现

下面可以看一下具体的源代码来了解一下Notification工作的流程。

在`Jack`类中调用了`super.sendNotification(notification);`后，会执行`NotificationBroadcasterSupport`类中的`sendNotification`方法：

```java
public void sendNotification(Notification notification) {

    if (notification == null) {
        return;
    }

    boolean enabled;

    for (ListenerInfo li : listenerList) {
        try {
            enabled = li.filter == null ||
                li.filter.isNotificationEnabled(notification);
        } catch (Exception e) {
            if (logger.debugOn()) {
                logger.debug("sendNotification", e);
            }

            continue;
        }

        if (enabled) {
            executor.execute(new SendNotifJob(notification, li));
        }
    }
}
```

很简单，就是遍历所有注册的listener，然后把notification和listener封装成一个`SendNotifJob`对象，在线程池中执行，看一下`SendNotifJob`的定义：

```java
private class SendNotifJob implements Runnable {
    public SendNotifJob(Notification notif, ListenerInfo listenerInfo) {
        this.notif = notif;
        this.listenerInfo = listenerInfo;
    }

    public void run() {
        try {
            handleNotification(listenerInfo.listener,
                               notif, listenerInfo.handback);
        } catch (Exception e) {
            if (logger.debugOn()) {
                logger.debug("SendNotifJob-run", e);
            }
        }
    }

    private final Notification notif;
    private final ListenerInfo listenerInfo;
}
```

该类实现了`Runnable`接口，在`run`方法中，调用`handleNotification`方法，看一下该方法的实现：

```java
 protected void handleNotification(NotificationListener listener,
                                      Notification notif, Object handback) {
    listener.handleNotification(notif, handback);
}
```

这里调用了listener的`handleNotification`方法，在`JackListener`中实现的就是该方法。下面是`NotificationListener`接口的定义：

```java
public interface NotificationListener extends java.util.EventListener   {

    public void handleNotification(Notification notification, Object handback);
}
```

该接口只有一个方法，同时`NotificationListener`继承自`java.util.EventListener`，这个接口并没有任何方法的定义，仅仅代表一种类型。

看到这就应该很好理解了，这就是观察者模式的实现，不熟悉的话可以参考一下之前的文章：[设计模式：观察者模式](/2016/12/04/设计模式：观察者模式/)，其实还有一个更具体的例子，参考[Tomcat源码：生命周期](/2016/12/05/Tomcat源码：生命周期/)。
