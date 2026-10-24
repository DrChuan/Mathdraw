const inputs=[`椭圆 C x
M=(1,3/2)
F是C的右焦点
onCurve(M,C)
MF⊥x轴
P=(4,0)
l=过点直线(P)
A,B=交点(C,l)
N=Midpoint(F,P)
r=Line(N,B)
s_1=Line(M,F)
Q=交点(r,s_1)
s=Segment(A,Q)`,
`双曲线 C y
F_1=(0,4)
F_2=(0,-4)
P=(-6,4)
focus(F_1,C,2)
focus(F_2,C,1)
onCurve(P,C)`,
`椭圆 E
A=(0,-2)
B=(3/2,-1)
onCurve(A,E)
onCurve(B,E)
P=(1,-2)
l=过点直线(P)
M,N=交点(E,l)
s=Segment(A,B)
r: y=y(M)
T=交点(s,r)
H=(?,?)
vectorRelation(vec(MT)=vec(TH))
s_1=Line(H,N)`,
`抛物线 C x
l: x-2*y+1=0
A,B=交点(C,l)
AB=4*sqrt(15)
F=Focus(C,1)
M=(?,?)
N=(?,?)
onCurve(M,C)
onCurve(N,C)
dot(MF,NF)=0
(x(M)-x(N))^2+(y(M)-y(N))^2>0
t=Triangle(M,N,F)`,
`a=?
b=?
c=?
C: x^2+y^2+4*y-1=0
l: a*x+b*y+c=0
2*b=a+c
A,B=交点(C,l)
s=Segment(A,B)`];
export const lessonExamples=inputs.map((input,i)=>({input,title:["2024 全国甲卷理科第20题 · 椭圆与焦点","2024 全国甲卷理科第5题 · 双曲线","2022 全国乙卷理科第20题 · 椭圆与向量","2023 全国甲卷理科第20题 · 抛物线弦长","2024 全国甲卷理科第12题 · 直线与圆"][i],url:["https://static-gkcx.gaokao.cn/upload/zhenti/20240826/1724667231_6668.pdf","https://gaokaohub.com/paper/2024-quanguo-jia-li-math.html","https://91apu.cn/shuxue/gkt/2022/2022qgyl/2022-12-16/33487.html","https://gaokaohub.com/q/item/113723264236980.html","https://gaokaohub.com/paper/2024-quanguo-jia-li-math.html"][i],original:[
"已知椭圆 C: x²/a²+y²/b²=1 (a>b>0) 的右焦点为 F，点 M(1,3/2) 在 C 上，且 MF⊥x轴。（1）求 C 的方程；（2）过点 P(4,0) 的直线交 C 于 A、B 两点，N 为线段 FP 的中点，直线 NB 交直线 MF 于点 Q，证明：AQ⊥y轴。",
"已知双曲线 C: y²/a²−x²/b²=1 (a>0,b>0) 的上、下焦点分别为 F₁(0,4)、F₂(0,−4)，点 P(−6,4) 在该双曲线上，则该双曲线的离心率为（ ）。A.4 B.3 C.2 D.√2。",
"已知椭圆 E 的中心为坐标原点，对称轴为 x轴、y轴，且过 A(0,−2)、B(3/2,−1) 两点。（1）求 E 的方程；（2）设过点 P(1,−2) 的直线交 E 于 M、N 两点，过 M 且平行于 x轴的直线与线段 AB 交于点 T，点 H 满足向量 MT=向量 TH。证明：直线 HN 过定点。",
"已知直线 x−2y+1=0 与抛物线 C: y²=2px (p>0) 交于 A、B 两点，且 |AB|=4√15。（1）求 p；（2）设 C 的焦点为 F，M、N 为 C 上两点，向量 MF·向量 NF=0，求三角形 MNF 面积的最小值。",
"已知 b 是 a、c 的等差中项，直线 ax+by+c=0 与圆 x²+y²+4y−1=0 交于 A、B 两点，则 |AB| 的最小值为（ ）。A.1 B.2 C.4 D.2√5。"
][i]}));
