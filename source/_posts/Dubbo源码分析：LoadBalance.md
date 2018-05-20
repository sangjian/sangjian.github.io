---
title: Dubbo源码分析：LoadBalance
date: 2018-05-16 23:40:00
categories:
- 开发手册
- 分布式
tags:
- 计算机
- 分布式
- Java
- Dubbo
---

前两篇文章分析了 `Directory` 和 `Router` ，本文继续分析第三个部分 `LoadBalance` 的实现。

回顾一下 `AbstractClusterInvoker` 中的 `invoke` 方法：

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

<!-- more -->

这里通过 `SPI` 获取了一个 `loadBalance` 对象，关于 `SPI` 的分析将在以后的文章展开，这里先知道这里只是通过将要调用的服务名称来获取一个 `loadBalance` 实例即可。

在 `doInvoke` 方法执行中，会调用 `AbstractClusterInvoker` 中的 `select` 方法：

```java
private Invoker<T> doSelect(LoadBalance loadbalance, Invocation invocation, List<Invoker<T>> invokers, List<Invoker<T>> selected) throws RpcException {
    if (invokers == null || invokers.isEmpty())
        return null;
    if (invokers.size() == 1)
        return invokers.get(0);
    if (loadbalance == null) {
        loadbalance = ExtensionLoader.getExtensionLoader(LoadBalance.class).getExtension(Constants.DEFAULT_LOADBALANCE);
    }
    Invoker<T> invoker = loadbalance.select(invokers, getUrl(), invocation);

    //If the `invoker` is in the  `selected` or invoker is unavailable && availablecheck is true, reselect.
    if ((selected != null && selected.contains(invoker))
            || (!invoker.isAvailable() && getUrl() != null && availablecheck)) {
        try {
            Invoker<T> rinvoker = reselect(loadbalance, invocation, invokers, selected, availablecheck);
            if (rinvoker != null) {
                invoker = rinvoker;
            } else {
                //Check the index of current selected invoker, if it's not the last one, choose the one at index+1.
                int index = invokers.indexOf(invoker);
                try {
                    //Avoid collision
                    invoker = index < invokers.size() - 1 ? invokers.get(index + 1) : invokers.get(0);
                } catch (Exception e) {
                    logger.warn(e.getMessage() + " may because invokers list dynamic change, ignore.", e);
                }
            }
        } catch (Throwable t) {
            logger.error("cluster reselect fail reason is :" + t.getMessage() + " if can not solve, you can set cluster.availablecheck=false in url", t);
        }
    }
    return invoker;
}
```

这里会调用 `loadBalance` 的 `select` 方法。我们先看下 `LoadBalance` 的类图：

{% asset_img "loadBalance.png" %}

## 负载均衡策略

主要有4个实现类来实现不同的负载均衡策略。看下官网的描述：

### Random LoadBalance

* **随机**，按权重设置随机概率。
* 在一个截面上碰撞的概率高，但调用量越大分布越均匀，而且按概率使用权重后也比较均匀，有利于动态调整提供者权重。

### RoundRobin LoadBalance

* **轮循**，按公约后的权重设置轮循比率。
* 存在慢的提供者累积请求的问题，比如：第二台机器很慢，但没挂，当请求调到第二台时就卡在那，久而久之，所有请求都卡在调到第二台上。

### LeastActive LoadBalance

* **最少活跃调用数**，相同活跃数的随机，活跃数指调用前后计数差。
* 使慢的提供者收到更少请求，因为越慢的提供者的调用前后计数差会越大。

### ConsistentHash LoadBalance

* **一致性 Hash**，相同参数的请求总是发到同一提供者。
* 当某一台提供者挂时，原本发往该提供者的请求，基于虚拟节点，平摊到其它提供者，不会引起剧烈变动。
* 算法参见：[http://en.wikipedia.org/wiki/Consistent_hashing](http://en.wikipedia.org/wiki/Consistent_hashing)
* 缺省只对第一个参数 Hash，如果要修改，请配置 `<dubbo:parameter key="hash.arguments" value="0,1" />`
* 缺省用 160 份虚拟节点，如果要修改，请配置 `<dubbo:parameter key="hash.nodes" value="320" />`

## 代码分析

### 权重的计算

`AbstractLoadBalance` 是 `LoadBalance` 接口的默认实现抽象类，我们来看看此类具体的实现：

```java
public abstract class AbstractLoadBalance implements LoadBalance {

    static int calculateWarmupWeight(int uptime, int warmup, int weight) {
        int ww = (int) ((float) uptime / ((float) warmup / (float) weight));
        return ww < 1 ? 1 : (ww > weight ? weight : ww);
    }

    @Override
    public <T> Invoker<T> select(List<Invoker<T>> invokers, URL url, Invocation invocation) {
        if (invokers == null || invokers.isEmpty())
            return null;
        if (invokers.size() == 1)
            return invokers.get(0);
        return doSelect(invokers, url, invocation);
    }

    protected abstract <T> Invoker<T> doSelect(List<Invoker<T>> invokers, URL url, Invocation invocation);

    protected int getWeight(Invoker<?> invoker, Invocation invocation) {
        int weight = invoker.getUrl().getMethodParameter(invocation.getMethodName(), Constants.WEIGHT_KEY, Constants.DEFAULT_WEIGHT);
        if (weight > 0) {
            long timestamp = invoker.getUrl().getParameter(Constants.REMOTE_TIMESTAMP_KEY, 0L);
            if (timestamp > 0L) {
                int uptime = (int) (System.currentTimeMillis() - timestamp);
                int warmup = invoker.getUrl().getParameter(Constants.WARMUP_KEY, Constants.DEFAULT_WARMUP);
                if (uptime > 0 && uptime < warmup) {
                    weight = calculateWarmupWeight(uptime, warmup, weight);
                }
            }
        }
        return weight;
    }

}
```

可以看到，这里的 `select` 方法会调用具体由子类来实现的 `doSelect` 方法，另外比较重要的是 `getWeight` 方法，用来计算 `invoker` 的权重。下面分析一下 `getWeight` 方法，看下具体权重的值是怎么计算的。

该方法有如下几个变量：

* **weight**：权重，默认是100；
* **uptime**： `invoker` 运行的时间，也就是当前的时间 - `invoker` 启动的时间；
* **warmup**： `invoker` 预热时间，默认是10分钟。

即当 `invoker` 运行时间小于10分钟，则需要计算权重，运行时间大于10分钟，权重就是设置的值，默认是100。

看下权重的计算：

```java
static int calculateWarmupWeight(int uptime, int warmup, int weight) {
    int ww = (int) ((float) uptime / ((float) warmup / (float) weight));
    return ww < 1 ? 1 : (ww > weight ? weight : ww);
}
```

计算规则很简单，即： `运行时间 / （ 预热时间 / 权重 ）` ，也就是说当 `invoker` 运行时间小于10分钟时， `invoker` 的运行时间越长，其权重越高。

### RandomLoadBalance

dubbo默认的是 `Random LoadBalance` ，看下 `RandomLoadBalance` 中的 `doSelect` 方法：

```java
@Override
protected <T> Invoker<T> doSelect(List<Invoker<T>> invokers, URL url, Invocation invocation) {
    int length = invokers.size(); // Number of invokers
    int totalWeight = 0; // The sum of weights
    boolean sameWeight = true; // Every invoker has the same weight?
    for (int i = 0; i < length; i++) {
        int weight = getWeight(invokers.get(i), invocation);
        totalWeight += weight; // Sum
        if (sameWeight && i > 0
                && weight != getWeight(invokers.get(i - 1), invocation)) {
            sameWeight = false;
        }
    }
    if (totalWeight > 0 && !sameWeight) {
        // If (not every invoker has the same weight & at least one invoker's weight>0), select randomly based on totalWeight.
        int offset = random.nextInt(totalWeight);
        // Return a invoker based on the random value.
        for (int i = 0; i < length; i++) {
            offset -= getWeight(invokers.get(i), invocation);
            if (offset < 0) {
                return invokers.get(i);
            }
        }
    }
    // If all invokers have the same weight value or totalWeight=0, return evenly.
    return invokers.get(random.nextInt(length));
}
```

这个规则很简单，循环遍历获取每个 `invoker` 的权重，如果权重一样，也就是 `sameWeight` 为 `true` ，那么就随机选取一个 `invoker`，否则就会按照权重来选取。

### RoundRobinLoadBalance

```java
public class RoundRobinLoadBalance extends AbstractLoadBalance {

    public static final String NAME = "roundrobin";

    private final ConcurrentMap<String, AtomicPositiveInteger> sequences = new ConcurrentHashMap<String, AtomicPositiveInteger>();

    @Override
    protected <T> Invoker<T> doSelect(List<Invoker<T>> invokers, URL url, Invocation invocation) {
        String key = invokers.get(0).getUrl().getServiceKey() + "." + invocation.getMethodName();
        int length = invokers.size(); // Number of invokers
        int maxWeight = 0; // The maximum weight
        int minWeight = Integer.MAX_VALUE; // The minimum weight
        final LinkedHashMap<Invoker<T>, IntegerWrapper> invokerToWeightMap = new LinkedHashMap<Invoker<T>, IntegerWrapper>();
        int weightSum = 0;
        // 获取最大权重和最小权重
        for (int i = 0; i < length; i++) {
            int weight = getWeight(invokers.get(i), invocation);
            maxWeight = Math.max(maxWeight, weight); // Choose the maximum weight
            minWeight = Math.min(minWeight, weight); // Choose the minimum weight
            if (weight > 0) {
                invokerToWeightMap.put(invokers.get(i), new IntegerWrapper(weight));
                weightSum += weight;
            }
        }
        // 当前调用的序号，如果是第一次调用则设置一个新的对象
        AtomicPositiveInteger sequence = sequences.get(key);
        if (sequence == null) {
            sequences.putIfAbsent(key, new AtomicPositiveInteger());
            sequence = sequences.get(key);
        }
        // 增加调用序号
        int currentSequence = sequence.getAndIncrement();
        // 如果权重不相等，则按权重轮询
        if (maxWeight > 0 && minWeight < maxWeight) {
            int mod = currentSequence % weightSum;
            for (int i = 0; i < maxWeight; i++) {
                for (Map.Entry<Invoker<T>, IntegerWrapper> each : invokerToWeightMap.entrySet()) {
                    final Invoker<T> k = each.getKey();
                    final IntegerWrapper v = each.getValue();
                    if (mod == 0 && v.getValue() > 0) {
                        return k;
                    }
                    if (v.getValue() > 0) {
                        v.decrement();
                        mod--;
                    }
                }
            }
        }
        // 如果权重相等，则直接取模
        // Round robin
        return invokers.get(currentSequence % length);
    }

    private static final class IntegerWrapper {
        private int value;

        public IntegerWrapper(int value) {
            this.value = value;
        }

        public int getValue() {
            return value;
        }

        public void setValue(int value) {
            this.value = value;
        }

        public void decrement() {
            this.value--;
        }
    }

}
```

这里注意 `doSelect` 中按权重轮询的部分：

* 第一个 `for` 循环将循环次数设置为 `maxWeight` ，因为最大的权重就是 `maxWeight` ，所以遍历完之后肯定会有一个 `Invoker` 满足条件并返回；
* 第二个 `for` 循环遍历，当对应的 `Invoker` 的权重大于0的时候，也就是 `IntegerWrapper` 对象的 `getValue` 大于0的时候就将 `mod` 和对应的 `value`，即 `invoker` 对应的权重，都减一，如果到最后 `mod` 为0的时候如果 `invoker` 对应的权重大于0，则分配到该 `invoker`。

最后，如果权重都是相同的，则直接取模就可以了。

### LeastActiveLoadBalance

该种方式思路主要是，获取最小的活跃数，把活跃数等于最小活跃数的 `invoker` 维护成一个数组，如果权重一致随机取出，如果不同则跟 `RandomLoadBalance` 一致，累加权重，然后随机取出，实现如下：

```java
@Override
protected <T> Invoker<T> doSelect(List<Invoker<T>> invokers, URL url, Invocation invocation) {
    int length = invokers.size(); // Number of invokers
    int leastActive = -1; // The least active value of all invokers
    int leastCount = 0; // The number of invokers having the same least active value (leastActive)
    int[] leastIndexs = new int[length]; // The index of invokers having the same least active value (leastActive)
    int totalWeight = 0; // The sum of weights
    int firstWeight = 0; // Initial value, used for comparision
    boolean sameWeight = true; // Every invoker has the same weight value?
    for (int i = 0; i < length; i++) {
        Invoker<T> invoker = invokers.get(i);
        int active = RpcStatus.getStatus(invoker.getUrl(), invocation.getMethodName()).getActive(); // Active number
        int weight = invoker.getUrl().getMethodParameter(invocation.getMethodName(), Constants.WEIGHT_KEY, Constants.DEFAULT_WEIGHT); // Weight
        if (leastActive == -1 || active < leastActive) { // 如果当前invoker的活动数小于之前的活动数，则重新开始计算
            leastActive = active; // Record the current least active value
            leastCount = 1; // Reset leastCount, count again based on current leastCount
            leastIndexs[0] = i; // Reset
            totalWeight = weight; // Reset
            firstWeight = weight; // Record the weight the first invoker
            sameWeight = true; // Reset, every invoker has the same weight value?
        } else if (active == leastActive) { // 如果当前的活动数与之前的invoker的活动数相同，则将索引记录到数组，并累加权重
            leastIndexs[leastCount++] = i; // Record index number of this invoker
            totalWeight += weight; // Add this invoker's weight to totalWeight.
            // If every invoker has the same weight?
            if (sameWeight && i > 0
                    && weight != firstWeight) {
                sameWeight = false;
            }
        }
    }
    // assert(leastCount > 0)
    if (leastCount == 1) {
        // If we got exactly one invoker having the least active value, return this invoker directly.
        return invokers.get(leastIndexs[0]);
    }
    // 如果权重不同，并且总的权重大于0，则按权重随机取出invoker
    if (!sameWeight && totalWeight > 0) {
        // If (not every invoker has the same weight & at least one invoker's weight>0), select randomly based on totalWeight.
        int offsetWeight = random.nextInt(totalWeight);
        // Return a invoker based on the random value.
        for (int i = 0; i < leastCount; i++) {
            int leastIndex = leastIndexs[i];
            offsetWeight -= getWeight(invokers.get(leastIndex), invocation);
            if (offsetWeight <= 0)
                return invokers.get(leastIndex);
        }
    }
    // If all invokers have the same weight value or totalWeight=0, return evenly.
    return invokers.get(leastIndexs[random.nextInt(leastCount)]);
}
```

这里代码的最后一段，其实与 `RandomLoadBalance` 的实现是一致的。

### ConsistentHashLoadBalance

在dubbo中，默认的虚拟节点是160，一致性哈希的算法我后续会介绍，大家也可以参考其他的文章来了解一下这个算法。