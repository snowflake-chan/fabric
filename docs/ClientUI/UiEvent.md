<script setup>
import '/style.css'
</script>

# 事件监听

```typescript
declare const ui: UiNode;
```

> 负责处理事件的组件，其中 listener 接受的参数即触发的事件对象。可监听的事件由组件的宿主决定。

## 方法

#### <font id="API" />on(<font id="Type">type: string, listener:[UiNode](/ClientUI/UiNode)=>void</font>)<font id="Type">: void</font> {#on}

监听指定的事件。

**输入参数**

| **参数** | **必填** | **默认值** | **类型** | **说明**                   |
| -------- | -------- | ---------- | -------- | -------------------------- |
| type     | 是       |            | string   | 监听的事件类型，是个字符串 |
| listener | 是       |            | Function | 监听到事件类型后的处理函数 |

#### <font id="API" />once(<font id="Type">type: string, listener:[UiNode](/ClientUI/UiNode)=>void</font>)<font id="Type">: void</font> {#once}

与 on 的区别是仅触发一次。

**输入参数**

| **参数** | **必填** | **默认值** | **类型** | **说明**                   |
| -------- | -------- | ---------- | -------- | -------------------------- |
| type     | 是       |            | string   | 监听的事件类型，是个字符串 |
| listener | 是       |            | Function | 监听到事件类型后的处理函数 |

#### <font id="API" />remove(<font id="Type">type: string, listener:[UiNode](/ClientUI/UiNode)=>void</font>)<font id="Type">: void</font> {#remove}

移除找到的第一个 listener。

**输入参数**

| **参数** | **必填** | **默认值** | **类型** | **说明**                   |
| -------- | -------- | ---------- | -------- | -------------------------- |
| type     | 是       |            | string   | 监听的事件类型，是个字符串 |
| listener | 是       |            | Function | 监听到事件类型后的处理函数 |

#### <font id="API" />removeAll(<font id="Type">type: string, listener?:[UiNode](/ClientUI/UiNode)=>void</font>)<font id="Type">: void</font> {#removeAll}

移除找到的所有 listener，不传则移除事件下所有。

**输入参数**

| **参数** | **必填** | **默认值** | **类型** | **说明**                   |
| -------- | -------- | ---------- | -------- | -------------------------- |
| type     | 是       |            | string   | 监听的事件类型，是个字符串 |
| listener |          |            | Function | 监听到事件类型后的处理函数 |

#### <font id="API" />add(<font id="Type">type: string, listener?:[UiNode](/ClientUI/UiNode)=>void</font>)<font id="Type">: void</font> {#add}

与 on 是同一个方法,只是方法名不同。

**输入参数**

| **参数** | **必填** | **默认值** | **类型** | **说明**                   |
| -------- | -------- | ---------- | -------- | -------------------------- |
| type     | 是       |            | string   | 监听的事件类型，是个字符串 |
| listener |          |            | Function | 监听到事件类型后的处理函数 |

#### <font id="API" />emit(<font id="Type">type: string, event?:any</font>)<font id="Type">: void</font> {#emit}

触发指定的事件。

**输入参数**

| **参数** | **必填** | **默认值** | **类型** | **说明**                                 |
| -------- | -------- | ---------- | -------- | ---------------------------------------- |
| type     | 是       |            | string   | 要触发的事件类型；                       |
| event    |          |            | any      | 要触发的事件对象，会被作为监听器的参数。 |

#### <font id="API" />off(<font id="Type">type: string, event?:any</font>)<font id="Type">: void</font> {#off}

与 remove 是同一个方法,只是方法名不同。

**输入参数**

| **参数** | **必填** | **默认值** | **类型** | **说明**                                 |
| -------- | -------- | ---------- | -------- | ---------------------------------------- |
| type     | 是       |            | string   | 要触发的事件类型；                       |
| event    |          |            | any      | 要触发的事件对象，会被作为监听器的参数。 |
