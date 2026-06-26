<script setup>
import '/style.css'
</script>

# 操作数据

## 属性

#### <font id="API" /><font id="ReadOnly">只读</font>key<font id="Type">: string</font> {#key}

> 默认值：空间名称

获取数据存储空间名称。

::: details 点击查看示例代码

```javascript
const userStorage = storage.getDataStorage('users');
const storageName = userStorage.key;
console.log(`storageName: ${storageName}`);
```

:::

## 方法

#### <font id="API" />increment(<font id="Type">key: string,value?:number</font>)<font id="Type">: Promise‹number›</font> {#increment}

原子方式递增给定键的值，当对应键不存在时视作设置值，对应值不为数字时报错。

- 通过此方式修改值时不会触发数据锁定。

**输入参数**

| **参数** | **必填** | **默认值** | **类型** | **说明**     |
| -------- | -------- | ---------- | -------- | ------------ |
| key      | 是       |            | string   | 需要递增的键 |
| value    |          | 1          | number   | 递增量       |

**返回值**

| **类型** | **说明**                                                |
| -------- | ------------------------------------------------------- |
| number   | 异步返回递增后的值，当获取完成时 resolve，否则 reject。 |

#### <font id="API" />set(<font id="Type">key: string,value:[JSONValue](./setSpace#JSONValue)</font>)<font id="Type">: Promise‹void›</font> {#set}

传入指定键与值，无论该键是否存在，均将值设置到此键上。

**输入参数**

| **参数** | **必填** | **默认值** | **类型**  | **说明**     |
| -------- | -------- | ---------- | --------- | ------------ |
| key      | 是       |            | string    | 需要设置的键 |
| value    | 是       |            | JSONValue | 需要设置的值 |

#### <font id="API" />get(<font id="Type">key: string</font>)<font id="Type">: Promise‹[ReturnValue](./setSpace#ReturnValue)›</font> {#get}

获取指定键对应的值。

**输入参数**

| **参数** | **必填** | **默认值** | **类型** | **说明** |
| -------- | -------- | ---------- | -------- | -------- |
| key      | 是       |            | string   | 指定的键 |

**返回值**

| **类型**    | **说明**                                          |
| ----------- | ------------------------------------------------- |
| ReturnValue | 异步返回数据，当获取完成时 resolve，否则 reject。 |

#### <font id="API" />update(<font id="Type">key: string,handler:(prevValue:[ReturnValue](./setSpace#ReturnValue))=>[JSONValue](./setSpace#JSONValue)</font>)<font id="Type">: Promise‹void›</font> {#update}

更新指定键对应的值。

**输入参数**

| **参数** | **必填** | **默认值** | **类型** | **说明**                                                       |
| -------- | -------- | ---------- | -------- | -------------------------------------------------------------- |
| key      | 是       |            | string   | 指定的键                                                       |
| handler  | 是       |            | function | 处理更新的方法，接受一个参数，为当前键的值，返回一个更新后的值 |

#### <font id="API" />remove(<font id="Type">key: string</font>)<font id="Type">: Promise‹[ReturnValue](./setSpace#ReturnValue)›</font> {#remove}

删除指定键值对。

**输入参数**

| **参数** | **必填** | **默认值** | **类型** | **说明** |
| -------- | -------- | ---------- | -------- | -------- |
| key      | 是       |            | string   | 指定的键 |

**返回值**

| **类型**    | **说明**                                          |
| ----------- | ------------------------------------------------- |
| ReturnValue | 异步返回数据，当删除完成时 resolve，否则 reject。 |

#### <font id="API" />list(<font id="Type">options:Partial‹[ListPageOptions](./setSpace#ListPageOptions)›</font>)<font id="Type">: Promise‹[QueryList](./setSpace#QueryList)›</font> {#list}

批量获取键值对。

**输入参数**

| **参数** | **必填** | **默认值** | **类型**                 | **说明**               |
| -------- | -------- | ---------- | ------------------------ | ---------------------- |
| options  | 是       |            | Partial‹ListPageOptions› | 批量获取键值对的配置项 |

**返回值**

| **类型**  | **说明**                                          |
| --------- | ------------------------------------------------- |
| QueryList | 异步返回数据，当获取完成时 resolve，否则 reject。 |

#### <font id="API" />destroy()<font id="Type">: Promise‹void›</font> {#destroy}

删除该数据空间。

## 接口

#### <font id="API" />JSONValue {#JSONValue}

允许存储的值，类型可以是如下类型之一：

| **参数**                  | **说明**       |
| ------------------------- | -------------- |
| string                    | 字符串         |
| number                    | 数字           |
| boolean                   | 布尔值         |
| JSONValue[]               | JSONValue 数组 |
| `{[x: string]:JSONValue}` | 键值对         |

#### <font id="API" />ReturnValue {#ReturnValue}

表示一个键值对的内容。它可以是一个对象或者 `undefined`

| **参数**   | **类型**  | **说明**         |
| ---------- | --------- | ---------------- |
| key        | string    | 键名称           |
| value      | JSONValue | 值内容           |
| updateTime | number    | key 最近更新时间 |
| createTime | number    | key 创建时间     |
| version    | string    | 更新版本号       |

#### <font id="API" />ListPageOptions {#ListPageOptions}

批量获取键值对的配置项。

| **参数**         | **类型** | **说明**                                                                                                                                                                                                                                                                                                  |
| ---------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cursor           | number   | **必选**分页指针，用于指定本次获取的分页起点页码。                                                                                                                                                                                                                                                        |
| pageSize         | number   | 可选项，分页大小，一页内的数据量，取值范围[0,100]，默认 100。                                                                                                                                                                                                                                             |
| constraintTarget | string   | - 约束目标值的路径，当值是 JSON 格式时，指定用作排序的值的路径。例如传入 `score`时，会取值上`score`属性的值作为排序、最大最小值的限制目标；<br/>- 可以级联最多 5 级，例如`a.b.c.d.e`，超出视作非法参数，按下一条方式处理；<br/>- 当路径不存在或传入非法参数时，以值本身作为目标进行排序，并打印一条警告； |
| ascending        | boolean  | 是否升序，设置为 true 时为升序，false 为降序，不传或传入 undefined 时不排序；                                                                                                                                                                                                                             |
| max              | number   | 最大值，过滤返回对应值的最大值，超出或非数字则不返回该 Key，默认不过滤；                                                                                                                                                                                                                                  |
| min              | number   | 最小值，同 max 类似。                                                                                                                                                                                                                                                                                     |

#### <font id="API" />QueryList {#QueryList}

键值对查询列表，用于批量获取键值对，通过 {GameDataStorage.list} 方法返回。

列表根据配置项被划分为一个或多个分页，每个分页最多包含 { [QueryList](./setSpace#QueryList) | pageSize} 个键值对。

| **参数**         | **类型**                                    | **说明**                                                                  |
| ---------------- | ------------------------------------------- | ------------------------------------------------------------------------- |
| isLastPage       | boolean                                     | 是否为最后一页，如果翻过头了，也会为 true                                 |
| getCurrentPage() | ()=>[ReturnValue](./setSpace#ReturnValue)[] | 按 {QueryList &#124; pageSize} 获取当前页的键值对，返回当前页的键值对内容 |
| nextPage()       | ()=> Promise‹void›                          | 翻到下一页，执行后 {getCurrentPage} 将返回下一页的键值对内容              |
