set(0,'DefaultTextFontSize',16)
clf, hold on
axis('normal')
x0=0;xf=3.5;y0=0;yf=xf^2;
axis([-.2 8 -.4 15])
axis off
plot([0 0],[-.4 yf],'-',[-.2 xf], [0 0],'-')
hold on
theta = .05*pi; rhopoint = .35;
fill([-rhopoint*sin(theta) 0 rhopoint*sin(theta)],[yf-rhopoint*cos(theta) yf yf-rhopoint*cos(theta)],'-')
r=-.1;  s=.64;
text(r,yf+s,'{\it y}')
for r = 1:11 plot([0 .1],[r r],'-'),end
r=.1;
text(-.2-r,.95,'1')
text(-.2-r,2,'2')
text(-.2-r,3,'3')
text(-.2-r,4,'4')
text(-.2-r,5,'5')
text(-.2-r,6,'6')
text(-.2-r,7,'7')
text(-.2-r,8,'8')
text(-.2-r,9,'9')
r=.13;
text(-.25-r,10,'10')
text(-.25-r,11,'11')
theta = .25*pi; rhopoint = .2;
fill([xf-rhopoint*cos(theta) xf xf-rhopoint*cos(theta)],[-rhopoint*sin(theta) 0 rhopoint*sin(theta)],'-')
text(xf+.075,0,'{\it x}')
for r = 1:3 plot([r r],[0 .2],'-'),end
text(.98,-.5,'1')
text(1.98,-.5,'2')
text(2.98,-.5,'3')
x=0:.01:xf; y=x.^2;plot(x,y,'-','LineWidth',.8)
plot([2 3],[3 9],':','LineWidth',.8)
plot([2 1],[3 1],':','LineWidth',.8)
plot([0 1],[1 1],':','LineWidth',.8)
plot([0 3],[9 9],':','LineWidth',.8)
plot([0 2],[3 3],':','LineWidth',.8)
plot([1 1],[0 1],':','LineWidth',.8)
plot([3 3],[0 9],':','LineWidth',.8)
plot([2 2],[0 3],':','LineWidth',.8)
