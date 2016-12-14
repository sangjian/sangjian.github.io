---
title: JMX：Standard MBean
date: 2016-12-14 21:44:20
categories: 开发手册
tags: 
- JMX
- Java
---

Standard MBean（标准管理构件）是JMX管理构件中最简单的一种，只需要开发一个MBean接口，一个实现MBean接口的类，并且把他们注册到MBeanServer中就可以了。

下面例子使用的是Java8，其中已经包含了jmx。该例中使用了`HtmlAdaptorServer`类，需要用到jmxtools.jar, 可以到 http://www.oracle.com/technetwork/java/javasebusiness/downloads/java-archive-downloads-java-plat-419418.html 下载，下载后的文件是jmx-1_2_1-ri.zip，解压后将jmxtools.jar导入到项目中即可。

<!-- more -->

## Standard MBean实例
首先定义一个MBean的接口：

```java
public interface HelloMBean {

    public void setName(String name);

    public String getName();

    public void sayHello();

}
```
包含在MBean中方法都将是可以被管理的。MBean起名是有规范的，后缀必须是MBean，否则会报错。

再创建一个要被管理的类`Hello`：

```java
public class Hello implements HelloMBean {

    private String name;

    @Override
    public String getName() {
        return name;
    }

    @Override
    public void setName(String name) {
        this.name = name;
    }

    @Override
    public void sayHello() {
        System.out.println("Hello : " + name);
    }
}
```

该类有一个`name`属性，实现了`sayHello`方法用来输出`name`属性。

再创建一个Agent类：

```java
public class HelloAgent {


    public static void main(String[] args) throws Exception{
        // 以下两种创建MBeanServer的方式都可以，但第一种不可以通过JConsole来查看
//        MBeanServer mBeanServer = MBeanServerFactory.createMBeanServer();
        MBeanServer mBeanServer = ManagementFactory.getPlatformMBeanServer();
        
        // 使用默认的domain
        String domain = mBeanServer.getDefaultDomain();
        ObjectName objectName = new ObjectName(domain+ ":name=Hello");
        // 注册到mBeanServer中
        mBeanServer.registerMBean(new Hello(), objectName);

        // 这里的port只不过是一个名字，取什么都无所谓
        ObjectName adapterName = new ObjectName(domain +
                ":name=htmladapter,port=8888");
        
        // 创建一个AdaptorServer，这个类将决定MBean的管理界面
        // HtmlAdaptorServer属于分布服务层, 提供了一个HtmlAdaptor
        // 支持Http访问协议，并且有一个HTML的管理界面
        // HtmlAdaptor是一个简单的HttpServer，它将Http请求转换为JMX Agent的请求
        HtmlAdaptorServer adapter = new HtmlAdaptorServer();
        // 设置访问的端口
        adapter.setPort(8888);
        adapter.start();
        mBeanServer.registerMBean(adapter, adapterName);
    }

}

```

## ObjectName介绍

其中介绍一下`ObjectName`，这个类的实例表示一个MBean的对象名，下面的内容参考自JDK文档：

> 表示 MBean 的对象名，或者能够与多个 MBean 名称相匹配的模式。此类的实例是不可变的。
> 
> 可使用此类的实例表示：
> 
> * 对象名
> * 查询的上下文中的对象名模式
> 
> 由两部分（域和键属性）组成的对象名。
> 
> *域* 是一个不包括冒号字符 (:) 的由字符组成的字符串。建议域不要包含字符串 "//"，该字符串保留供将来使用。
> 
> 如果域至少包括一个通配符星号 (*) 或问号 (?)，则该对象名就是一个模式。星号匹配任意零或多个字符的序列，而问号则匹配任意单个字符。
>
> 如果域为空，则由 MBean 服务器（在其中使用 ObjectName）的默认域 在特定的上下文中替换它。

> *键*属性 是一个无序的键和关联值的集合。
> 
> 每个*键* 都是一个由字符组成的非空字符串，不可以包含任何逗号 (,)、等号 (=)、冒号、星号或问号字符。在一个给定的 ObjectName 中，同一个键不能出现两次。

> 每个与键关联的值 都是由字符组成的字符串，或者由引号括起来或者不括起来。

> 无引号值 可能是一个空的字符串，不包含任意逗号、等号、冒号和引号。

> 如果无引号值 包括至少一个通配符星号或问号，则该对象名就是一个属性值模式。

> 有引号值 由一个引号 (")，后跟可能为空的字符串，然后是另一个引号所组成。在字符串中，反斜线 (\) 具有特殊的含义，它后面必须是下列某个字符：

> * 另一个反斜线。第二个反斜线不具有特殊的含义，两个字符表示单个反斜线。
> * 字符 'n'。这两个字符表示新行（Java 中的 '\n'）。
> * 引号。这两个字符表示一个引号，并且不将该引号视为有引号值的终止。为了使有引号值有效，必须有结束的闭合引号。
> * 问号 (?) 或星号 (*)。这两个字符分别表示一个问号或一个星号。
> 引号可能不出现在有引号值中，但紧跟在奇数个连续反斜线后的情况除外。

> 括住有引号值的引号和该值中的所有反斜线都被视为该值的一部分。

> 如果*引号值* 包括至少一个星号或问号，且星号或问号之前没有反斜杠，则将其视为通配符，并且该对象名是一个属性值模式。星号匹配任意零或多个字符的序列，而问号则匹配任意单个字符。

> ObjectName 可能是一种*属性列表模式*。在这种情况下，它可以有零个或多个键和关联值。它与非模式的 ObjectName 匹配，该 ObjectName 的域与相同的键和关联值匹配且包含它们，并且可能包括其他键和值。

> 当至少有一个 ObjectName 的有引号 或无引号 键属性值包含通配符星号或问号（如上所述）时，ObjectName 是一个属性值模式。在这种情况下，它有一个或多个键以及关联值，并至少有一个值包含通配符。它与一个无模式 ObjectName 相匹配，该 ObjectName 的域与之匹配，或者包含值与之匹配的相同键；如果属性值模式也是属性列表模式，则无模式 ObjectName 也可以包含其他键和值。

> 如果 ObjectName 是属性列表模式 或属性值模式，或者两者都是，则它是一个属性模式。

> 如果某个 ObjectName 的域包含通配符或者 ObjectName 是一个属性模式，则该 ObjectName 是一个模式。

> 如果某个 ObjectName 不是一个模式，那么它必须至少包含一个键及其关联值。

> ObjectName 模式的示例有：

> * \*:type=Foo,name=Bar 匹配键的具体设置为 type=Foo,name=Bar 的任何域中的名称。
d:type=Foo,name=Bar,\* 匹配具有键 type=Foo,name=Bar 以及 0 或其他键的域 d 中的名称。
> * \*:type=Foo,name=Bar,\* 匹配具有键 type=Foo,name=Bar 以及 0 或其他键的域中的名称。
> * d:type=F?o,name=Bar 将与诸如 d:type=Foo,name=Bar 和 d:type=Fro,name=Bar 之类的键和名称匹配。
> * d:type=F\*o,name=Bar 将与诸如 d:type=Fo,name=Bar 和 d:type=Frodo,name=Bar 之类的键和名称匹配。
> * d:type=Foo,name="B\*" 将与诸如 d:type=Foo,name="Bling" 之类的键和名称匹配。通配符在引号中也能被识别，并且像其他特殊字符一样可以使用 \ 转义。
> 
> 按顺序使用下列元素可将 ObjectName 写为 String：
> 
> * 域。
> * 一个冒号 (:)。
> * 如下定义的键属性列表。
> 写为 String 的键属性列表是一个逗号分隔的元素列表。每个元素都是一个星号或一个键属性。键属性由键、等号 (=) 和关联值组成。

> 键属性列表中最多只能有一个元素为星号。如果键属性列表包含星号元素，则该 ObjectName 是一个属性列表模式。

> 在表示 ObjectName 的 String 中，空格没有任何特殊含意。例如，String：

> domain: key1 = value1 , key2 = value2
 
> 表示具有两个键的 ObjectName。每个键的名字包含 6 个字符，其中第一个和最后一个都是空格。与键 " key1 " 相关联的值同样以空格开头和结尾。
> 
> 除了上述提及的字符限制外，ObjectName 的任何部分都不能包含换行符 ('\n')，无论这些部分是域、键还是值（无引号值和有引号值）。可使用序列 \n 将换行符表示为有引号值。

> 不管使用何种构造方法构建 ObjectName，关于特殊字符和引号的规则都适用。

> 为了避免不同供应商所提供的 MBean 之间出现冲突，提供了一个有用的约定：域名由指定该 MBean 的企业的反向 DNS 名开始，后跟一个句点和一个字符串，由该企业决定该字符串的解释。例如，由 Sun Microsystems Inc.（DNS 名是 sun.com）所指定的 MBean 将有 com.sun.MyDomain 这样的域。这基本上与 Java 语言包名的约定相同。

## 使用HtmlAdaptorServer查看MBean

下面运行一下该程序，访问http://localhost:8888来查看一下：

{% asset_img "屏幕快照 2016-12-14 下午11.50.40.png" %}

可以看到在默认域名下注册的“name=Hello”，点进去后可以看到MBean中的属性和方法：

{% asset_img "屏幕快照 2016-12-14 下午11.37.23.png" %}

可以看到，在`Access`列中的值是`RW`，说明是可读写的，因为在`HelloMBean`接口中定义了`setName`和`getName`方法，如果只定义了`getName`方法，`Access`的值将会是`RO`，表示是只读的。在`Name`列中的值是`Name`，这个是和getter和setter方法对应的，并不与定义的`name`属性对应。在`Value`列中可以修改`Name`的值，然后点击`Apply`按钮后，就可以将属性的值设置到MBean当中。

在下面的operations中，可以看到之前定义的`sayHello`方法，点击这个按钮后，可以在控制台上查看输出的结果。例如，将`Name`的值设置为123，点击`Apply`按钮，然后点击`sayHello`按钮，页面显示：

{% asset_img "屏幕快照 2016-12-14 下午11.46.53.png" %}

在控制台中可以看到输出的结果为：

```
Hello : 123
```

## 使用jconsole查看MBean

还可以通过`jconsole`来查看MBean，可以通过`jconsole`作为客户端来管理MBean。

将本例中的`HelloAgent`中的代码修改为：

```java
public static void main(String[] args) throws Exception{
    MBeanServer mBeanServer = ManagementFactory.getPlatformMBeanServer();
//        MBeanServer mBeanServer = MBeanServerFactory.createMBeanServer();
    String domain = mBeanServer.getDefaultDomain();
    ObjectName objectName = new ObjectName(domain+ ":name=Hello");
    mBeanServer.registerMBean(new Hello(), objectName);

    ObjectName adapterName = new ObjectName(domain +
            ":name=htmladapter,port=8888");

    System.out.println("start.....");

    Thread.sleep(Integer.MAX_VALUE);
}
```

进入命令行，输入`jconsole`命令打开jsonsole：

{% asset_img "屏幕快照 2016-12-15 上午12.03.56.png" %}

选中本例运行的进程后点击“连接”，进入管理页面，选择"MBean"标签：

{% asset_img "屏幕快照 2016-12-15 上午12.05.36.png" %}

在这里可以看到注册的MBean，可以看到在`Hello`这个MBean中的属性和操作，这里的使用与`HtmlAdaptorServer`的使用类似，大家可以自己试一下。在这里将属性的值设置为123，然后在“操作”中点击`sayHello`按钮：

{% asset_img "屏幕快照 2016-12-15 上午12.09.16.png" %}

在控制台同样可以看到输出：

```
Hello : 123
```

jconsole还可以通过远程来连接，很轻松的来管理MBean。


