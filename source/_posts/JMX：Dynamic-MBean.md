---
title: JMX：Dynamic MBean
date: 2016-12-21 23:14:35
categories: 开发手册
tags: 
- JMX
- Java
---

Dynamic MBean不需要自定义MBean接口，只需要实现DynamicMBean接口即可，Dynamic MBean没有任何明显些在代码里的属性和方法，所有的属性和方法都是通过反射结合JMX提供的辅助元数据从而动态生成。换句话说，它可以使用动态的配置来实现一个类中的哪些方法或者属性可以被注册到jmx去管理。

下面实现一个具体的代码，其中主要涉及3个类，分别是Hello,HelloDynamic和HelloAgent。其中Hello是一个普通的JavaBean，可以看做实际被管理的bean；HelloDynamic是一个动态的MBean，通过它来代理Hello类型的JavaBean，对其暴露一些需要被管理的属性和方法；HelloAgent中有main方法，用于启动。这里同样使用了`HtmlAdaptorServer`来通过浏览器查看和管理MBean。

<!-- more -->

下面看一下Hello类的实现：

```java
public class Hello {

    private String name = "Hello World";

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public void print(){
        System.out.println(name);
    }
}
```

很普通，没必要说了，再看一下HelloDynamic类的实现：

```java
public class HelloDynamic implements DynamicMBean {

    private Hello hello = new Hello();

    private List<MBeanAttributeInfo> attributeInfos = new ArrayList<>();

    private List<MBeanConstructorInfo> constructorInfos = new ArrayList<>();

    private List<MBeanOperationInfo> operationInfos = new ArrayList<>();

    private List<MBeanNotificationInfo> notificationInfos = new ArrayList<>();

    private MBeanInfo mBeanInfo;

    public HelloDynamic() {
        try {
            init();
        } catch (NoSuchMethodException e) {
            e.printStackTrace();
        }
    }

    private void init() throws NoSuchMethodException {
        buildDynamicInfo();
        mBeanInfo = createMBeanInfo();
    }

    /**
     * 创建需要被管理的构造器、属性和方法
     *
     * @throws NoSuchMethodException
     */
    private void buildDynamicInfo() throws NoSuchMethodException {
        constructorInfos.add(new MBeanConstructorInfo("Hello构造器", hello.getClass().getConstructors()[0]));
        attributeInfos.add(new MBeanAttributeInfo("name", "java.lang.String", "name属性", true, true, false));
        operationInfos.add(new MBeanOperationInfo("print()方法.", hello.getClass().getMethod("print", null)));
    }

    /**
     * 创建MBeanInfo对象
     *
     * @return
     */
    private MBeanInfo createMBeanInfo() {
        return new MBeanInfo(this.getClass().getName(),
                "HelloDynamic",
                attributeInfos.toArray(new MBeanAttributeInfo[attributeInfos.size()]),
                constructorInfos.toArray(new MBeanConstructorInfo[constructorInfos.size()]),
                operationInfos.toArray(new MBeanOperationInfo[operationInfos.size()]),
                notificationInfos.toArray(new MBeanNotificationInfo[notificationInfos.size()])
        );
    }

    @Override
    public Object getAttribute(String attribute) throws AttributeNotFoundException, MBeanException, ReflectionException {
        try {
            return PropertyUtils.getProperty(hello, attribute);
        } catch (Exception e) {
            e.printStackTrace();
        }
        return null;
    }

    @Override
    public void setAttribute(Attribute attribute) throws AttributeNotFoundException, InvalidAttributeValueException, MBeanException, ReflectionException {
        try {
            PropertyUtils.setProperty(hello, attribute.getName(), attribute.getValue());
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @Override
    public AttributeList getAttributes(String[] attributes) {
        if (attributes == null || attributes.length == 0) {
            return null;
        }
        try {
            AttributeList attrList = new AttributeList();
            for (String attrName : attributes) {
                Object obj = this.getAttribute(attrName);
                Attribute attribute = new Attribute(attrName, obj);
                attrList.add(attribute);
            }
            return attrList;
        } catch (Exception e) {
            e.printStackTrace();
        }
        return null;
    }

    @Override
    public AttributeList setAttributes(AttributeList attributes) {
        if (attributes == null || attributes.isEmpty()) {
            return attributes;
        }
        try {
            for (Object attribute1 : attributes) {
                Attribute attribute = (Attribute) attribute1;
                setAttribute(attribute);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
        return attributes;
    }

    @Override
    public Object invoke(String actionName, Object[] params, String[] signature) throws MBeanException, ReflectionException {
        try {
            Method methods[] = hello.getClass().getMethods();
            for (Method method : methods) {
                String name = method.getName();
                if (name.equals(actionName)) {
                    Object result = method.invoke(hello, params);
                    if (result != null) {
                        System.out.println(result);
                    }
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
        return null;
    }

    @Override
    public MBeanInfo getMBeanInfo() {
        return mBeanInfo;
    }
}

```

这里实现了`DynamicMBean`接口，可见该类中的方法都是通过反射来工作的，这样就可以理解为什么叫做Dynamic MBean了，利用反射可以动态的增加或删除属性和方法。

HelloAgent类的实现：

```java
public class HelloAgent {

    public static void main(String[] args) throws MalformedObjectNameException, NotCompliantMBeanException, InstanceAlreadyExistsException, MBeanRegistrationException {
        String domain = "DynamicTest";
        MBeanServer server = MBeanServerFactory.createMBeanServer();
        //创建DynamicMBean对象
        HelloDynamic helloDynamic = new HelloDynamic();

        HtmlAdaptorServer htmlAdaptorServer = new HtmlAdaptorServer();
        htmlAdaptorServer.setPort(9999);
        ObjectName objName = new ObjectName(domain + ":name=HelloDynamic");
        ObjectName htmlObjName = new ObjectName(domain + ":name=HtmlAdaptor");
        // 注册MBean
        server.registerMBean(helloDynamic, objName);
        // 注册adaptor
        server.registerMBean(htmlAdaptorServer, htmlObjName);
        //启动服务
        htmlAdaptorServer.start();
        System.out.println("starting...");
    }

}

```

如果看过前两篇的JMX内容，那么可以看出，没什么不一样的地方，我们运行一下该程序，打开浏览器，输入http://localhost:9999 查看：

{% asset_img "QQ20161222-0@2x.png" %}

点击`name=HelloDynamic`后，可以看到，Hello中的属性和方法已经被注册进来了：

{% asset_img "QQ20161222-0.png" %}

点击`print`按钮后，在控制台可以看到效果：

```
starting...
Hello World
```